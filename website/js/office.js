// 'use strict';


firebase.initializeApp({
  apiKey: 'AIzaSyCadBqkHUJwdcgKT11rp_XWkbQLFAy80JQ',
  authDomain: 'growthfilev2-0.firebaseapp.com',
  databaseURL: 'https://growthfilev2-0.firebaseio.com',
  projectId: 'growthfilev2-0',
});

// needs to be global for gMaps to work. // See docs.
let map;

function initMap() {
  const curr = {
    lat: 28.5492074,
    lng: 77.2505593,
  };

  map = new google.maps.Map(
    document.getElementById('map'), {
      zoom: 16,
      center: curr,
    }
  );

  const marker = new google.maps.Marker({ position: curr, map });

  // const elems = document.querySelector('.branch-list-container ul').children;

  // new Promise((resolve, reject) => {
  //   Array.from(elems).forEach((item) => {
  //     new google.maps.Marker({
  //       position: {
  //         lat: Number(item.dataset.latitude),
  //         lng: Number(item.dataset.longitude),
  //       },
  //       map,
  //     });
  //   });

  //   return resolve(true);
  // });
}

function signInSuccessWithAuthResult(authResult, redirectUrl) {
  console.log('signin success');

  document.querySelector('.modal').style.display = 'none';
}

function signInFailure(error) {
  console.log('signin failed', error);
}

function uiShown() {
  // widget has renderred
  console.log('ui was shown');
}

const uiConfig = {
  signInOptions: [{
    provider: firebase.auth.PhoneAuthProvider.PROVIDER_ID,
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
  }
};

const ui = new firebaseui.auth.AuthUI(firebase.auth());


function handleResponse(response) {
  console.log(response);
};

function handleProductClick(param) {
  /**
   * brand: ""
    model: ""
    productType: ""
    size: ""
   */
  console.log(param);
};


function handleBranchClick(latitude, longitude) {
  const position = {
    lat: Number(latitude),
    lng: Number(longitude),
  };

  console.log(latitude, longitude);

  if (latitude && longitude) {
    const marker = new google.maps.Marker({ position, map });

    map.setCenter(position);
  }
}


function showLoginModal() {
  console.log('showing modal');

  document.querySelector('.modal').style.display = 'block';
  ui.start('#firebaseui-auth-container', uiConfig);
}

function sendEnquiryRequest(body) {
  return firebase
    .auth()
    .currentUser
    .getIdToken()
    .then((idToken) => {
      const authorization = `Bearer ${idToken}`;
      console.log('authorization', authorization);

      console.log('body', body);

      return fetch('https://us-central1-growthfilev2-0.cloudfunctions.net/api/enquiry', {
        body: JSON.stringify(body),
        method: 'POST',
        headers: {
          'Authorization': authorization,
          'Content-Type': 'application/json',
        },
      });
    })
    .then((response) => response.text())
    .then((data) => {
      console.log('success', data);
    })
    .catch(console.error);
};


function handleEnquiry(event) {
  const name = document.getElementsByName('person-name')[0];
  const email = document.getElementsByName('person-email')[0];
  const phoneNumber = document.getElementsByName('person-phone-number')[0];
  const enquiryText = document.getElementsByName('text-area')[0];

  const enquiryObject = {
    name: name.value,
    email: email.value,
    phoneNumber: phoneNumber.value,
    enquiryText: enquiryText.value,
  };

  if (!firebase.auth().currentUser) {
    localStorage.setItem('enquiryObject', JSON.stringify(enquiryObject));

    return showLoginModal();
  }

  const currentUser = firebase.auth().currentUser;
  const authUpdate = {};

  if (name.value && currentUser.name !== name.value) {
    authUpdate.display = name.value;
  }

  // if (!currentUser.email) {
  //   currentUser
  //     .updateEmail(email.value)
  //     .catch(console.error);
  // }

  // if (currentUser.email && !currentUser.emailVerified) {
  //   currentUser
  //     .sendEmailVerification()
  //     .catch(console.error);
  // }

  console.log('dataset', document.body.dataset);

  const body = {
    enquiryText: enquiryText.value,
    office: document.body.dataset.slug,
    companyName: 'Test Company',
    timestamp: Date.now(),
    geopoint: {
      latitude: 28.5492026,
      longitude: 77.2505871,
    },
  };

  return sendEnquiryRequest(body);
}

const formSubmitButton = document.querySelector('.form-submit-button');

formSubmitButton.addEventListener('click', handleEnquiry);

window
  .onload = function () { initMap() };
