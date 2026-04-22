/**
 * AACP Accessibility Scanner Engine
 * Alphapointe Accessibility Certification Program
 *
 * Runs axe-core against a list of URLs via Puppeteer,
 * stores violations in Supabase, computes delta alerts for Tier 3 clients.
 *
 * Architecture: zero DOM modification — scan and report only.
 * This is the monitoring tool pattern validated by the AIOPS Group report.
 */

'use strict';

require('dotenv').config();

const puppeteer   = require('puppeteer-core');
const { createClient } = require('@supabase/supabase-js');
const path        = require('path');
const fs          = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || '';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const CHROME_PATH   = process.env.CHROME_PATH   || '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const WCAG_LEVEL    = process.env.WCAG_LEVEL    || 'wcag22aa';
const PAGE_TIMEOUT  = parseInt(process.env.PAGE_TIMEOUT || '30000', 10);
const CONCURRENCY   = parseInt(process.env.SCAN_CONCURRENCY || '3', 10);

// ── Supabase client (service role — full DB access, scanner only) ──────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── WCAG criterion normalizer ────────────────────────────────────────────────
const IMPACT_MAP = {
  critical: 'critical',
  serious:  'critical',   // axe "serious" → AACP "critical"
  moderate: 'high',
  minor:    'medium',
};

function extractWcagSC(tags = []) {
  const sc = tags.find(t => /^wcag\d+\.\d+/.test(t));
  if (!sc) return null;
  return sc.replace('wcag', '').replace(/(\d)(\d)(\d)/, '$1.$2.$3');
}

// ── Inject axe-core into page ────────────────────────────────────────────────
function getAxeSource() {
  const axePath = require.resolve('axe-core');
  return fs.readFileSync(axePath, 'utf8');
}

// ── Single page scan ─────────────────────────────────────────────────────────
async function scanPage(browser, url, wcagLevel = WCAG_LEVEL) {
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    // Minimal footprint — no tracking, no analytics, no cookies written
    await page.setExtraHTTPHeaders({ 'User-Agent': 'AACP-Scanner/1.0 (Alphapointe Accessibility Audit)' });
    await page.setViewport({ width: 1280, height: 800 });

    // Block ads/tracking to reduce noise in results
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) return req.abort();
      if (/google-analytics|googletagmanager|facebook\.net|hotjar|mouseflow/.test(url)) return req.abort();
      req.continue();
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

    // Inject axe-core and run — zero DOM modification
    await page.evaluate(getAxeSource());

    const results = await page.evaluate((level) => {
      return axe.run(document, {
        runOnly: {
          type: 'tag',
          values: [level, 'best-practice'],
        },
        resultTypes: ['violations', 'passes', 'incomplete'],
      });
    }, wcagLevel);

    const duration = Date.now() - startTime;

    return {
      success: true,
      url,
      results,
      duration,
      axeVersion: results.testEngine?.version || 'unknown',
    };

  } catch (err) {
    return {
      success: false,
      url,
      error: err.message,
      duration: Date.now() - startTime,
    };
  } finally {
    await page.close();
  }
}

// ── Store scan results in Supabase ────────────────────────────────────────────
async function storeScan({ engagementId, clientId, scanResult, wcagLevel }) {
  const { url, results, duration, axeVersion, error, success } = scanResult;

  // 1. Insert scan record
  const { data: scan, error: scanErr } = await supabase
    .from('scans')
    .insert({
      engagement_id:      engagementId,
      client_id:          clientId,
      url,
      status:             success ? 'complete' : 'error',
      axe_version:        axeVersion,
      wcag_level:         wcagLevel,
      violations_raw:     success ? results : null,
      passes_count:       success ? (results.passes?.length || 0) : 0,
      violations_count:   success ? (results.violations?.length || 0) : 0,
      incomplete_count:   success ? (results.incomplete?.length || 0) : 0,
      inapplicable_count: success ? (results.inapplicable?.length || 0) : 0,
      duration_ms:        duration,
      error_message:      error || null,
      completed_at:       new Date().toISOString(),
    })
    .select('id')
    .single();

  if (scanErr) throw new Error(`Scan insert failed: ${scanErr.message}`);

  if (!success || !results?.violations?.length) {
    return { scanId: scan.id, violationsInserted: 0 };
  }

  // 2. Normalize violations into flat rows
  const violationRows = [];

  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      violationRows.push({
        scan_id:         scan.id,
        client_id:       clientId,
        engagement_id:   engagementId,
        rule_id:         violation.id,
        description:     violation.description,
        help:            violation.help,
        help_url:        violation.helpUrl,
        impact:          IMPACT_MAP[violation.impact] || violation.impact,
        wcag_criteria:   violation.tags,
        wcag_sc:         extractWcagSC(violation.tags),
        element_html:    node.html?.substring(0, 500) || null,
        element_target:  Array.isArray(node.target) ? node.target.join(', ') : String(node.target || ''),
        failure_summary: node.failureSummary?.substring(0, 1000) || null,
      });
    }
  }

  // Batch insert violations
  if (violationRows.length > 0) {
    const { error: vErr } = await supabase
      .from('violations')
      .insert(violationRows);

    if (vErr) throw new Error(`Violations insert failed: ${vErr.message}`);
  }

  return { scanId: scan.id, violationsInserted: violationRows.length };
}

// ── Delta detection for Tier 3 monitoring ────────────────────────────────────
// Compares current violations against the previous scan for the same URL.
// Any rule_id present now that was absent before → new delta alert.
async function computeDeltas(clientId, scanId, url, currentRules) {
  // Find the most recent prior complete scan for this URL
  const { data: priorScans } = await supabase
    .from('scans')
    .select('id')
    .eq('client_id', clientId)
    .eq('url', url)
    .eq('status', 'complete')
    .neq('id', scanId)
    .order('completed_at', { ascending: false })
    .limit(1);

  if (!priorScans?.length) return 0; // First scan — no delta

  const priorScanId = priorScans[0].id;

  const { data: priorViolations } = await supabase
    .from('violations')
    .select('rule_id, element_target')
    .eq('scan_id', priorScanId);

  const priorKeys = new Set(
    (priorViolations || []).map(v => `${v.rule_id}:${v.element_target}`)
  );

  // New violations not seen in prior scan
  const newViolations = currentRules.filter(v => !priorKeys.has(`${v.rule_id}:${v.element_target}`));

  if (!newViolations.length) return 0;

  // Fetch violation IDs just inserted for this scan
  const { data: insertedViolations } = await supabase
    .from('violations')
    .select('id, rule_id, impact, element_target')
    .eq('scan_id', scanId)
    .in('rule_id', newViolations.map(v => v.rule_id));

  const deltaRows = (insertedViolations || []).map(v => ({
    client_id:      clientId,
    scan_id:        scanId,
    violation_id:   v.id,
    rule_id:        v.rule_id,
    impact:         v.impact,
    url,
    element_target: v.element_target,
  }));

  if (deltaRows.length > 0) {
    await supabase.from('delta_alerts').insert(deltaRows);
  }

  return deltaRows.length;
}

// ── Semaphore for concurrency control ───────────────────────────────────────
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }
  acquire() {
    return new Promise(resolve => {
      if (this.count < this.max) { this.count++; resolve(); }
      else this.queue.push(resolve);
    });
  }
  release() {
    this.count--;
    if (this.queue.length) { this.count++; this.queue.shift()(); }
  }
}

// ── Main scan runner ─────────────────────────────────────────────────────────
async function runEngagement(engagementId) {
  console.log(`\n▶  AACP Scanner starting engagement ${engagementId}`);

  // Load engagement + client
  const { data: eng, error: engErr } = await supabase
    .from('engagements')
    .select('*, clients(*)')
    .eq('id', engagementId)
    .single();

  if (engErr || !eng) throw new Error(`Engagement not found: ${engagementId}`);

  const client = eng.clients;
  const urls   = eng.scan_scope;

  console.log(`   Client : ${client.name} (${client.tier.toUpperCase()})`);
  console.log(`   URLs   : ${urls.length} pages to scan`);
  console.log(`   WCAG   : ${WCAG_LEVEL}`);

  // Update engagement status
  await supabase.from('engagements').update({ status: 'scanning' }).eq('id', engagementId);

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });

  const sem = new Semaphore(CONCURRENCY);
  const allResults = [];
  const startTime = Date.now();

  try {
    const tasks = urls.map(url => async () => {
      await sem.acquire();
      try {
        process.stdout.write(`   Scanning: ${url} ... `);
        const result = await scanPage(browser, url);
        process.stdout.write(result.success
          ? `✓ ${result.results.violations?.length || 0} violations (${result.duration}ms)\n`
          : `✗ ERROR: ${result.error}\n`
        );

        const stored = await storeScan({
          engagementId,
          clientId: client.id,
          scanResult: result,
          wcagLevel: WCAG_LEVEL,
        });

        // Tier 3: compute deltas
        let deltaCount = 0;
        if (client.tier === 'tier3' && result.success) {
          const currentRules = (result.results.violations || []).flatMap(v =>
            v.nodes.map(n => ({
              rule_id:       v.id,
              element_target: Array.isArray(n.target) ? n.target.join(', ') : String(n.target || ''),
            }))
          );
          deltaCount = await computeDeltas(client.id, stored.scanId, url, currentRules);
          if (deltaCount > 0) {
            console.log(`   ⚠  ${deltaCount} NEW violations detected vs. prior scan → delta alerts created`);
          }
        }

        allResults.push({ url, ...stored, deltaCount });
      } finally {
        sem.release();
      }
    });

    await Promise.all(tasks.map(t => t()));

  } finally {
    await browser.close();
  }

  // ── Compute certification determination ──────────────────────────────────
  const { data: allViolations } = await supabase
    .from('violations')
    .select('impact')
    .eq('engagement_id', engagementId);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of allViolations || []) {
    if (counts[v.impact] !== undefined) counts[v.impact]++;
  }

  // AACP threshold: 0 critical + ≤2 high = CERTIFIED
  const certStatus = counts.critical === 0 && counts.high <= 2 ? 'certified' : 'not_certified';
  const expiresAt  = certStatus === 'certified'
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Insert certification record
  const { data: cert } = await supabase
    .from('certifications')
    .insert({
      client_id:      client.id,
      engagement_id:  engagementId,
      status:         certStatus,
      critical_count: counts.critical,
      high_count:     counts.high,
      medium_count:   counts.medium,
      low_count:      counts.low,
      pages_tested:   urls.length,
      expires_at:     expiresAt,
    })
    .select('seal_token')
    .single();

  // Update engagement to complete
  await supabase.from('engagements')
    .update({ status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', engagementId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  AACP SCAN COMPLETE — ${client.name}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Pages scanned   : ${urls.length}`);
  console.log(`  Critical        : ${counts.critical}`);
  console.log(`  High            : ${counts.high}`);
  console.log(`  Medium          : ${counts.medium}`);
  console.log(`  Low             : ${counts.low}`);
  console.log(`  Certification   : ${certStatus.toUpperCase()}`);
  if (cert?.seal_token) {
    console.log(`  Seal token      : ${cert.seal_token}`);
  }
  console.log(`  Total time      : ${elapsed}s`);
  console.log(`${'═'.repeat(60)}\n`);

  return { certStatus, counts, sealToken: cert?.seal_token };
}

// ── CLI entry point ───────────────────────────────────────────────────────────
async function main() {
  const [,, command, ...args] = process.argv;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
    console.error('Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  switch (command) {

    case 'scan': {
      // Usage: node scanner.js scan <engagementId>
      const [engagementId] = args;
      if (!engagementId) {
        console.error('Usage: node scanner.js scan <engagement-uuid>');
        process.exit(1);
      }
      await runEngagement(engagementId);
      break;
    }

    case 'quick': {
      // Usage: node scanner.js quick <url> [url2] [url3...]
      // Creates a temporary engagement and scans inline — useful for demos
      const urls = args;
      if (!urls.length) {
        console.error('Usage: node scanner.js quick <url> [url2...]');
        process.exit(1);
      }

      console.log(`\n▶  AACP Quick Scan — ${urls.length} URL(s)`);

      const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        headless: true,
      });

      const sem = new Semaphore(CONCURRENCY);
      const quickResults = [];

      try {
        const tasks = urls.map(url => async () => {
          await sem.acquire();
          try {
            process.stdout.write(`   Scanning: ${url} ... `);
            const r = await scanPage(browser, url);
            process.stdout.write(r.success
              ? `✓ ${r.results.violations?.length || 0} violations\n`
              : `✗ ${r.error}\n`
            );
            quickResults.push(r);
          } finally {
            sem.release();
          }
        });
        await Promise.all(tasks.map(t => t()));
      } finally {
        await browser.close();
      }

      // Print violation summary
      for (const r of quickResults) {
        if (!r.success) continue;
        console.log(`\n  ${r.url}`);
        for (const v of r.results.violations || []) {
          console.log(`  [${(IMPACT_MAP[v.impact] || v.impact).toUpperCase().padEnd(8)}] ${v.id} — ${v.help}`);
          console.log(`           ${v.nodes.length} element(s) affected`);
        }
      }
      break;
    }

    case 'deltas': {
      // Usage: node scanner.js deltas <clientId>
      // Show unresolved delta alerts for a Tier 3 client
      const [clientId] = args;
      if (!clientId) {
        console.error('Usage: node scanner.js deltas <client-uuid>');
        process.exit(1);
      }
      const { data: alerts } = await supabase
        .from('delta_alerts')
        .select('*, clients(name)')
        .eq('client_id', clientId)
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (!alerts?.length) {
        console.log('No unresolved delta alerts for this client.');
      } else {
        console.log(`\n⚠  ${alerts.length} unresolved delta alerts\n`);
        for (const a of alerts) {
          console.log(`  [${(a.impact || '').toUpperCase().padEnd(8)}] ${a.rule_id}`);
          console.log(`           URL: ${a.url}`);
          console.log(`           Target: ${a.element_target}`);
          console.log(`           Detected: ${new Date(a.created_at).toLocaleDateString()}\n`);
        }
      }
      break;
    }

    default:
      console.log(`
AACP Scanner — Alphapointe Accessibility Certification Program
axe-core ${require('axe-core').version} / WCAG ${WCAG_LEVEL}

Commands:
  scan <engagement-uuid>     Run full scan for a stored engagement
  quick <url> [url2...]      Scan URLs inline without DB engagement
  deltas <client-uuid>       Show Tier 3 unresolved delta alerts

Examples:
  node scanner.js quick https://example.com https://example.com/about
  node scanner.js scan 550e8400-e29b-41d4-a716-446655440000
  node scanner.js deltas 6ba7b810-9dad-11d1-80b4-00c04fd430c8
`);
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});

module.exports = { runEngagement, scanPage, storeScan, computeDeltas };
