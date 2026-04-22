/**
 * AACP Certification Badge Embed Script
 * Alphapointe Accessibility Certification Program
 *
 * ─────────────────────────────────────────────────────────────
 * ZERO DOM modification to your site content.
 * ZERO user tracking. ZERO cookies. ZERO fingerprinting.
 * Sends only: your domain name → Alphapointe verification API.
 * ─────────────────────────────────────────────────────────────
 *
 * Client installation (one line in footer):
 *   <script src="https://seal.alphapointe.org/badge.js" async></script>
 *
 * Or with explicit token (more reliable if domain changes):
 *   <script src="https://seal.alphapointe.org/badge.js"
 *           data-token="YOUR_SEAL_TOKEN" async></script>
 *
 * The badge auto-injects into any element with id="aacp-seal":
 *   <div id="aacp-seal"></div>
 *
 * Or floats in the bottom-right corner if no container is found.
 */

(function () {
  'use strict';

  const VERIFY_URL = 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-seal';
  const SCRIPT_EL  = document.currentScript;
  const TOKEN      = SCRIPT_EL?.getAttribute('data-token') || null;
  const DOMAIN     = window.location.hostname;

  // ── Build verification URL ─────────────────────────────────────────────────
  const verifyParam = TOKEN
    ? `?token=${encodeURIComponent(TOKEN)}`
    : `?domain=${encodeURIComponent(DOMAIN)}`;

  // ── Fetch certification status ─────────────────────────────────────────────
  fetch(VERIFY_URL + verifyParam, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    credentials: 'omit',   // No cookies sent or received
  })
  .then(r => r.json())
  .then(data => {
    if (data.valid && data.certified) {
      injectBadge(data);
    }
    // If not certified, script exits silently — no badge shown
  })
  .catch(() => {
    // Network error — exit silently, never break the client's page
  });

  // ── Badge renderer ─────────────────────────────────────────────────────────
  function injectBadge(cert) {
    const expires = cert.expires_at ? new Date(cert.expires_at) : null;
    const issued  = cert.issued_at  ? new Date(cert.issued_at)  : null;

    const dateStr = issued
      ? issued.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';

    // Badge HTML — self-contained, no external stylesheet dependencies
    const badge = document.createElement('div');
    badge.id = 'aacp-certification-badge';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label',
      `AACP Certified by Alphapointe — Tested for WCAG ${cert.wcag_level} conformance on ${dateStr}`
    );

    badge.innerHTML = `
      <a href="https://alphapointe.org/digital-accessibility/certification-seal/?verify=${TOKEN || DOMAIN}"
         target="_blank" rel="noopener noreferrer"
         style="
           display:flex; align-items:center; gap:10px;
           text-decoration:none; padding:10px 14px;
           background:#0D1A30; border:1px solid #14B870;
           border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.3);
           font-family:system-ui,sans-serif; max-width:260px;
         "
         aria-label="Verify AACP certification — opens Alphapointe verification page">

        <!-- Alphapointe "A" mark -->
        <span style="
          width:36px; height:36px; border-radius:6px; flex-shrink:0;
          background:linear-gradient(135deg,#0A7EA4,#1AA3CC);
          display:flex; align-items:center; justify-content:center;
          font-weight:900; font-size:18px; color:#fff;
          font-family:system-ui,sans-serif;
        " aria-hidden="true">A</span>

        <span style="line-height:1.3;">
          <span style="
            display:block; font-size:11px; font-weight:700;
            text-transform:uppercase; letter-spacing:0.08em; color:#14B870;
          ">AACP Certified</span>
          <span style="display:block; font-size:10px; color:#94A3B8; margin-top:1px;">
            ${escapeHtml(cert.wcag_level)} · ${escapeHtml(dateStr)}
          </span>
          <span style="display:block; font-size:9px; color:#475569; margin-top:2px;">
            Tested by blind professionals
          </span>
        </span>
      </a>
    `;

    // ── Find or create container ─────────────────────────────────────────────
    const container = document.getElementById('aacp-seal');

    if (container) {
      container.appendChild(badge);
    } else {
      // Float in bottom-right corner
      badge.style.cssText = `
        position:fixed; bottom:20px; right:20px; z-index:9999;
        animation:aacp-fadein 0.4s ease;
      `;

      // Inject keyframe animation
      const style = document.createElement('style');
      style.textContent = '@keyframes aacp-fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
      document.body.appendChild(badge);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
