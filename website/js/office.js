'use strict';


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

function modalContent() {
  const html =
    `<div class="modal-content">
  <div class="modal-head">
    <h2 class="mdc-typography--headline2">Enquiry</h2>
  </div>

  <div class="modal-text-fields-container">
    <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
      <input type="text" id="name-text-field" placeholder="Your Name" class="mdc-text-field__input">
    </div>

    <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
      <input type="email" id="email-text-field" placeholder="Your email" class="mdc-text-field__input">
    </div>

    <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
      <input type="text" id="company-name-text-field" placeholder="Your Company Name" class="mdc-text-field__input">
    </div>

    <div class="mdc-text-field mdc-text-field--textarea">
      <textarea id="enquiry-textarea" class="mdc-text-field__input" rows="8" cols="40"></textarea>
      <div class="mdc-notched-outline">
        <div class="mdc-notched-outline__leading"></div>
        <div class="mdc-notched-outline__notch">
          <label for="enquiry-textarea" class="mdc-floating-label">Your Enquiry</label>
        </div>
        <div class="mdc-notched-outline__trailing"></div>
      </div>
    </div>
  </div>

  <div class="centered">
    <button id="enquiry-submit-button" class="mdc-button mdc-button--raised">
      <i class="material-icons mdc-button__icon">send</i>
      <span class="mdc-button__label">Submit</span>
    </button>
    <div>
    </div>
  </div>
</div>`;

  return html;
}

function handleResponse(response) {
  console.log(response);
};

function handleSubmit(params) {
  const {
    name,
    email,
  } = params;

  console.log({ params });

  const currentUser = firebase.auth().currentUser;

  return Promise
    .all([
      currentUser
        .getIdToken(),
      currentUser
        .updateProfile({
          email,
          displayName: name,
        }),
    ])
    .then((result) => {
      const idToken = result[0];

      // 'https://api2.growthfile.com/api/enquiry'
      const url = 'https://us-central1-growthfilev2-0.cloudfunctions.net/api/enquiry';
      const options = {
        mode: 'cors',
        method: 'POST',
        body: JSON.stringify(params),
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      };

      console.log('fetching...');

      return fetch(url, options);
    })
    .then((response) => {
      console.log('fetched...');

      document.getElementById('enquiry-modal').style.display = 'none';
      document.body.style.overflowY = 'auto';

      console.log('Success');

      return response.json();
    })
    .then(handleResponse)
    .catch(console.error);
}

function getSpinnerElement() {
  const spinnerDiv = document.createElement('div');
  spinnerDiv.id = 'loader';

  spinnerDiv.innerHTML = `
  <svg class="spinner" width="30px" height="30px" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
    <circle class="path" fill="none" stroke-width="6" stroke-linecap="round" cx="33" cy="33" r="30"></circle>
  </svg>`;

  return spinnerDiv;
};

function handleFabClick(event) {
  const modal = document.getElementById('enquiry-modal');
  modal.style.display = 'block';
  document.body.style.overflowY = 'hidden';

  if (!firebase.auth().currentUser) {
    const modelContent = document.querySelector('.modal-content');

    modelContent
      .innerHTML = `
    <div class="modal-head">
      <h2 class="mdc-typography--headline2">Please log-in</h2>
    </div>`;

    const firebaseAuthUi = document.createElement('div');
    firebaseAuthUi.id = 'firebaseui-auth-container';
    firebaseAuthUi.style.marginTop = '10px';
    firebaseAuthUi.style.marginBottom = '10px';

    modelContent.appendChild(firebaseAuthUi);

    ui.start('#firebaseui-auth-container', uiConfig);

    return;
  }

  let submitButton = document.getElementById('enquiry-submit-button');

  if (!submitButton) {
    modal.innerHTML = modalContent();

    submitButton = document.getElementById('enquiry-submit-button');
  }

  submitButton.onclick = function () {
    console.log('submit button clicked');

    const name = document.getElementById('name-text-field');
    const email = document.getElementById('email-text-field');
    const companyName = document.getElementById('company-name-text-field');
    const enquiryTextarea = document.getElementById('enquiry-textarea');

    if (!name || !email || !companyName || !enquiryTextarea) {
      console.log('data missing', { name, email, companyName, enquiryTextarea });

      return;
    }

    const spinner = getSpinnerElement();
    const modalContent = document.querySelector('.modal-content');
    modalContent.innerHTML = '';

    spinner.id = 'modal-spinner';
    modalContent.appendChild(spinner);

    const params = {
      name: name.value,
      email: email.value,
      office: document.body.dataset.office,
    };

    handleSubmit(params);
  }
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

function productOnClick(elem) {
  console.log('clicked', elem);
}

document
  .querySelector('#enquiry-fab')
  .addEventListener('click', handleFabClick);

const bottomFab = document.getElementById('floating-bottombar-fab');

if (bottomFab) {
  bottomFab.addEventListener('click', handleFabClick)
}


window
  .onload = function () { initMap() };

window.onclick = function (event) {
  const modal = document.querySelector('.modal');

  if (event.target === modal) {
    modal.style.display = 'none';
    document.body.style.overflowY = 'auto';
  }
}
