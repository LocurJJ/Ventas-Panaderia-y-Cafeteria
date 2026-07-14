(function () {
  const config = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  };

  const isConfigured = config.databaseURL && config.projectId;

  if (!isConfigured) {
    console.warn("Firebase no esta configurado todavia. PegÃ¡ la configuracion del proyecto en js/firebase-config.js.");
    window.panaderiaFirebaseReady = false;
    return;
  }

  if (!window.firebase) {
    console.warn("No se cargo la libreria de Firebase.");
    window.panaderiaFirebaseReady = false;
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }

  window.panaderiaFirebaseReady = true;
  window.panaderiaFirebaseDb = firebase.database();
})();
