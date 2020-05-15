function AppKeys() {
    this.mode = 'production'
}
AppKeys.prototype.getMode = function () {
    return this.mode
}

AppKeys.prototype.getMapKey = function () {
    if (this.mode === 'dev') {
        return "AIzaSyB2SuCoyi9ngRIy6xZRYuzxoQJDtOheiUM"
    }
    return "AIzaSyBl6SlzDCW51UEYudI8kFwG41KePOjW7xI";
}
AppKeys.prototype.getKeys = function () {
    if (this.mode === 'production') {
        return {
            apiKey: "AIzaSyDnC555rqxozUQrJFYAwEdcQX94hnX2VLE",
            authDomain: "growthfile-207204.firebaseapp.com",
            databaseURL: "https://growthfile-207204.firebaseio.com",
            projectId: "growthfile-207204",
            storageBucket: "growthfile-207204.appspot.com",
            messagingSenderId: "701025551237",
            appId: "1:701025551237:web:9e52c3cfa0d45eaef67aec",
            measurementId: "G-BE8JKF8E38"
        }
    }
    return {
        apiKey: "AIzaSyB2SuCoyi9ngRIy6xZRYuzxoQJDtOheiUM",
        authDomain: "growthfilev2-0.firebaseapp.com",
        databaseURL: "https://growthfilev2-0.firebaseio.com",
        projectId: "growthfilev2-0",
        storageBucket: "growthfilev2-0.appspot.com",
        messagingSenderId: "1011478688238",
        appId: "1:1011478688238:web:707166c5b9729182d81eff",
        measurementId: "G-R2K1J16PTW"
    }
}
AppKeys.prototype.getBaseUrl = function () {
    return this.mode === 'production' ? 'https://api2.growthfile.com' : 'https://us-central1-growthfilev2-0.cloudfunctions.net'
}
var appKeys = new AppKeys();
firebase.initializeApp(appKeys.getKeys());
var analyticsApp = firebase.analytics()