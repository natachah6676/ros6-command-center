/**
 * Client Supabase (Publishable Key uniquement — jamais de secret / service role).
 */
(function (global) {
  const SUPABASE_URL = 'https://flussmbsccowystdqbvf.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f1Zs1tDX3vwp1nUlhjtV2w_jDg7HZhM';

  function createClient() {
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      throw new Error(
        'Bibliothèque Supabase absente. Vérifiez le chargement de @supabase/supabase-js.'
      );
    }
    return global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  let client = null;

  function getClient() {
    if (!client) client = createClient();
    return client;
  }

  global.ROSSupabase = {
    URL: SUPABASE_URL,
    PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
    getClient,
  };
})(window);
