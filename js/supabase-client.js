/**
 * Client Supabase (Publishable Key uniquement — jamais de secret / service role).
 */
(function (global) {
  const SUPABASE_URL = 'https://flussmbsccowystdqbvf.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f1Zs1tDX3vwp1nUlhjtV2w_jDg7HZhM';

  function assertLib() {
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      throw new Error(
        'Bibliothèque Supabase absente. Vérifiez le chargement de @supabase/supabase-js.'
      );
    }
  }

  function createClient() {
    assertLib();
    return global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  /**
   * Client jetable (création de compte R4/R5) — ne touche pas à la session du R5 connecté.
   */
  function createEphemeralClient() {
    assertLib();
    const memory = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    return global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: memory,
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
    createEphemeralClient,
  };
})(window);
