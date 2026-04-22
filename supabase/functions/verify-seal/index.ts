/**
 * AACP Seal Verification — Supabase Edge Function
 * Deployed at: https://YOUR_PROJECT.supabase.co/functions/v1/verify-seal
 *
 * Public endpoint. No auth required.
 * Called by client websites displaying the AACP certification badge.
 *
 * Deploy:
 *   supabase functions deploy verify-seal --no-verify-jwt
 *
 * Usage:
 *   GET /functions/v1/verify-seal?token=abc123sealtoken
 *   GET /functions/v1/verify-seal?domain=springfield.gov
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url    = new URL(req.url);
  const token  = url.searchParams.get('token');
  const domain = url.searchParams.get('domain');

  if (!token && !domain) {
    return new Response(JSON.stringify({
      error: 'Provide token= or domain= query parameter',
      example: '/functions/v1/verify-seal?token=abc123'
    }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Use service role for internal DB access
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let query = supabase
    .from('certifications')
    .select(`
      status,
      wcag_level,
      issued_at,
      expires_at,
      pages_tested,
      seal_token,
      critical_count,
      high_count,
      clients ( name, domain )
    `)
    .gt('expires_at', new Date().toISOString());

  if (token)  query = query.eq('seal_token', token);
  if (domain) query = query.eq('clients.domain', domain);

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return new Response(JSON.stringify({
      valid:  false,
      reason: 'Certification not found, expired, or token invalid',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const response = {
    valid:        true,
    certified:    data.status === 'certified',
    status:       data.status,
    client:       data.clients?.name,
    domain:       data.clients?.domain,
    wcag_level:   data.wcag_level,
    issued_at:    data.issued_at,
    expires_at:   data.expires_at,
    pages_tested: data.pages_tested,
    tested_by:    'Alphapointe — blind and low-vision professionals',
    // Do NOT expose critical_count in public response for liability reasons
    // Internal dashboard can query directly
  };

  // Cache for 1 hour — seals don't change mid-day
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    }
  });
});
