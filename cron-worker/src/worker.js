// Scheduled worker — denně volá /api/admin/test-all na hlavní Pages doméně.
// Deploy jako samostatný Worker s cron triggerem (v wrangler.toml).
// Nevolá s admin session — místo toho používá tajný klíč CRON_SECRET,
// který middleware u test-all akceptuje jako alternativu k Bearer.

export default {
  async scheduled(event, env, ctx) {
    const url = (env.APP_BASE_URL || 'https://fio-banka-3ns.pages.dev') + '/api/admin/test-all';
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': env.CRON_SECRET || ''
        },
        body: JSON.stringify({ trigger: 'cron' })
      });
      const text = await r.text();
      console.log('cron test-all', r.status, text.substring(0, 500));
    } catch (e) {
      console.error('cron error', e.message);
    }
  }
};
