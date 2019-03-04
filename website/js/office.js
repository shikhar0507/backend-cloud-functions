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
}

function signInSuccessWithAuthResult(authResult, redirectUrl, modal) {
  console.log('signin success');

  // addInputFieldsToModal();

  // hide .enquiry-modal
  document.getElementById('enquiry-modal').style.display = 'none';
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


// function handleBranchClick(latitude, longitude) {
//   const position = {
//     lat: Number(latitude),
//     lng: Number(longitude),
//   };

//   console.log(latitude, longitude);

//   if (latitude && longitude) {
//     const marker = new google.maps.Marker({ position, map });

//     map.setCenter(position);
//   }
// }

// function productOnClick(elem) {
//   console.log('clicked', elem);
// }

// document
//   .querySelector('#enquiry-fab')
//   .addEventListener('click', handleFabClick);

// const bottomFab = document.getElementById('floating-bottombar-fab');

// if (bottomFab) {
//   bottomFab.addEventListener('click', handleFabClick)
// }


window
  .onload = function () { initMap() };

// window.onclick = function (event) {
//   const modal = document.querySelector('.modal');

//   if (event.target === modal) {
//     modal.style.display = 'none';
//     document.body.style.overflowY = 'auto';
//   }
// }
