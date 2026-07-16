(function () {
  const config = {
    apiKey: "AIzaSyCQR5BOgJ62Ba0s-Jq1RP2LpPOrdiADOAM",
    authDomain: "cafeteriaypanaderia.firebaseapp.com",
    databaseURL: "https://cafeteriaypanaderia-default-rtdb.firebaseio.com",
    projectId: "cafeteriaypanaderia",
    storageBucket: "cafeteriaypanaderia.firebasestorage.app",
    messagingSenderId: "459241143036",
    appId: "1:459241143036:web:4d8d9f3ce934edaa1e7579",
  };

  const isConfigured = config.databaseURL && config.projectId;

  if (!isConfigured) {
    console.warn("Firebase no esta configurado todavia. Pega la configuracion del proyecto en js/firebase-config.js.");
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