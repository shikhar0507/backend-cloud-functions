let startPosition;

firebase.initializeApp(firebaseInitOptions);

function signInFailure(error) {
  console.log('signin failed', error);
}

function uiShown() {
  console.log('ui was shown');
}

function signInSuccessWithAuthResult(authResult, redirectUrl) {
  console.log('signin success');

  window.location.reload();
};

function getParsedCookies() {
  const cookieObject = {};

  document
    .cookie
    .split(';')
    .forEach((cookie) => {
      const parts = cookie.split('=');

      cookieObject[parts.shift().trim()] = decodeURI(parts.join('='));
    });

  return cookieObject;

};

function isNonEmptyString(string) {
  return typeof string === 'string' && string.trim() !== '';
}

function insertAfterNode(currentNode, nodeToInsert) {
  currentNode.parentNode.insertBefore(nodeToInsert, currentNode.nextSibling);
}

function logoutUser(event) {
  event.preventDefault();


  /** User isn't logged in */
  if (!firebase.auth().currentUser) return;

  console.log('logging out user...');

  document.cookie = `__session=`;

  return firebase
    .auth()
    .signOut()
    .then(function () {
      window.location.reload();

      return;
    }).catch(console.error);
};

function getModalElement(htmlContent, width) {
  const modal = picoModal({
    width,
    content: htmlContent,
    closeHtml: "<span>Close</span>",
    closeButton: false,
  })
    .afterClose(function (modal) { modal.destroy(); });

  return modal;
}

function getWarningNode(textContent) {
  valid = false;

  const warningNode = document.createElement('span');
  warningNode.classList.add('warning-label');
  warningNode.textContent = textContent;

  return warningNode;
}


const ui = new firebaseui.auth.AuthUI(firebase.auth());
const uiConfig = {
  signInOptions: [{
    provider: firebase.auth.PhoneAuthProvider.PROVIDER_ID,
    requireDisplayName: true,
    defaultCountry: 'IN',
    signInFlow: 'popup',
    recaptchaParameters: {
      type: 'image',
      size: 'invisible',
      badge: 'bottomleft',
    },
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

function askLocationPermission(event, callback) {
  if (!navigator.geolocation) {
    console.log('geolocation not supported');

    return;
  }

  function geoSuccess(position) {
    console.log('got the permission');

    // startPos.coords.latitude;
    // startPos.coords.longitude;
    startPosition = position;

    if (typeof callback === 'function') {
      callback(
        startPosition.coords.latitude,
        startPosition.coords.longitude
      );
    }
  }

  function geoError(error) {
    console.log('can not get permission', error);

    if (error.code === 0) {
      console.log('An unknown error occurred');
    }
    if (error.code === 1) {
      console.log('Permission denied');
    }
    if (error.code === 2) {
      console.log('position unavailable (error response from location provider)');
    }
    if (error.code === 3) {
      console.log('timed out');
    }
  }

  navigator.geolocation.getCurrentPosition(geoSuccess, geoError);
};

function getSpinnerElement() {
  const elem = document.createElement('div');
  elem.className = 'spinner';
  elem.style.position = 'relative';
  elem.style.height = '40px';
  elem.style.width = '40px';

  return elem;
}

function showLoginBox(width, modalId) {
  const modal = getModalElement(
    '<div id="firebaseui-auth-container"></div>',
    width,
    modalId,
  );

  modal.show();
  ui.start('#firebaseui-auth-container', uiConfig);

  return modal;
};


document.addEventListener('click', (event) => {
  if (event.target === document.getElementById('form-submit-button')) {
    return void startOfficeCreationFlow(event)
  }

  if (event.target === document.getElementById('header-login-button')) {
    event.preventDefault();

    return void showLoginBox('90%');
  }

  if (event.target === document.getElementById('header-profile-icon')) {
    // return void handleLogin(event);
  }

  if (event.target === document.getElementById('load-map-button')) {
    event.preventDefault();

    return void askLocationPermission(event, initMap);
  }

  if (event.target === document.getElementById('enquiry-submit-button')) {
    return void startEnquiryCreationFlow(event);
  }

  // TODO: Refactor this name. Not very unique and might cause conflicts.
  if (Array.from(document.querySelectorAll('.list-item')).includes(event.target)) {
    return void updateMapPointer(event);
  }

  const loginActionElements = [
    document.getElementById('add-employees'),
    document.getElementById('trigger-reports'),
    document.getElementById('change-phone-number'),
    document.getElementById('employee-resign'),
    document.getElementById('update-recipient'),
    document.getElementById('update-subscription'),
    document.getElementById('update-activity'),
  ];

  if (loginActionElements.includes(event.target)) {
    return void handleActionIconClick(event);
  }

  if (event.target === document.getElementById('menu-logout-link')) {
    return void logoutUser(event);
  }
});

document.addEventListener('DOMContentLoaded', function () {
  firebase
    .auth()
    .addAuthTokenListener(function (idToken) {
      if (!idToken) return;

      document.cookie = `__session=${idToken};max-age=${idToken ? 3600 : 0};`

      console.log('new cookie set', idToken);

      const hadSessionCookie = document.cookie.indexOf('__session=') !== -1;

      if ((hadSessionCookie && idToken) || hadSessionCookie && !idToken) {
        // window.location.reload();
      }
    });
});
