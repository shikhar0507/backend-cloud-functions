firebase.initializeApp({
  apiKey: 'AIzaSyCadBqkHUJwdcgKT11rp_XWkbQLFAy80JQ',
  authDomain: 'https://growthfilev2-0.firebaseapp.com',
  projectId: 'growthfilev2-0',
});

function signInFailure(error) {
  console.log('signin failed', error);
}

function uiShown() {
  console.log('ui was shown');
}

function signInSuccessWithAuthResult(authResult, redirectUrl) {
  console.log('signin success');
};

function isNonEmptyString(string) {
  return typeof string === 'string' && string.trim() !== '';
}

function insertAfterNode(currentNode, nodeToInsert) {
  currentNode.parentNode.insertBefore(nodeToInsert, currentNode.nextSibling);
}


const ui = new firebaseui.auth.AuthUI(firebase.auth());
const uiConfig = {
  signInOptions: [{
    provider: firebase.auth.PhoneAuthProvider.PROVIDER_ID,
    requireDisplayName: true,
    signInFlow: 'popup',
    recaptchaParameters: {
      type: 'image',
      size: 'invisible',
      badge: 'bottomleft',
    },
    defaultCountry: 'IN',
  }],
  tosUrl: 'https://growthfile.com/terms-of-service',
  privacyPolicyUrl: 'https://growthfile.com/privacy-policy',
  // https://github.com/firebase/firebaseui-web#example-with-all-parameters-used
  callbacks: {
    signInSuccessWithAuthResult,
    signInFailure,
    uiShown,
  },
};

function getMobileOperatingSystem() {
  var userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) {
    return 'Windows Phone';
  }

  if (/android/i.test(userAgent)) {
    return 'Android';
  }

  // iOS detection from: http://stackoverflow.com/a/9039885/177710
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return 'iOS';
  }

  return 'unknown';
};

function getSpinnerElement() {
  const elem = document.createElement('div');
  elem.className = 'spinner';
  elem.style.position = 'relative';
  elem.style.height = '40px';
  elem.style.width = '40px';

  return elem;
}
