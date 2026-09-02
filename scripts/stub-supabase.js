// Заглушка Supabase: проверяем логику кабинета без реального входа.
(function () {
  var profile = window.__STUB_PROFILE || null;
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  function table(name) {
    var api = {
      select: function () { return api; },
      eq: function () { return api; },
      order: function () { return api; },
      limit: function () { return api; },
      maybeSingle: function () { return res(name === "profiles" ? profile : null); },
      update: function (patch) { window.__STUB_UPDATES = (window.__STUB_UPDATES || []).concat([{ t: name, patch: patch }]);
                                 if (name === "profiles") profile = Object.assign({}, profile || {}, patch);
                                 return { eq: function () { return res(null); } }; },
      insert: function () { return { select: function () { return res([]); }, then: function (cb) { return res(null).then(cb); } }; },
      then: function (cb) { return res([]).then(cb); }
    };
    return api;
  }
  window.supabase = {
    createClient: function () {
      return {
        from: table,
        rpc: function () { return res([]); },
        storage: { from: function () { return { createSignedUrl: function () { return res(null); } }; } },
        auth: {
          getSession: function () { return res({ session: window.__STUB_SESSION }); },
          onAuthStateChange: function (cb) { setTimeout(function () { cb("SIGNED_IN", window.__STUB_SESSION); }, 30); return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { return res(null); }
        }
      };
    }
  };
  window.__STUB_SESSION = { user: { id: "00000000-0000-0000-0000-000000000001", email: "test@scholary.kz", user_metadata: { name: "Тест" } } };
})();
