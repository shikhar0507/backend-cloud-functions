'use strict';


// firebase.initializeApp({
//   apiKey: 'AIzaSyCadBqkHUJwdcgKT11rp_XWkbQLFAy80JQ',
//   authDomain: 'growthfilev2-0.firebaseapp.com',
//   databaseURL: 'https://growthfilev2-0.firebaseio.com',
//   projectId: 'growthfilev2-0',
// });

// const ui = new firebaseui.auth.AuthUI(firebase.auth());

// needs to be global for gMaps to work. // See docs.
let map;
let firebaseAuthModal;

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

  // document.querySelector('.modal').style.display = 'none';

  firebaseAuthModal.close();
};

function handleProductClick(param) {
  console.log(param);

  const html = `
  <div class="pico-product-details">
    <h2>${param.name}</h2>
    <img src="${param.imageUrl}">
    <p>Brand: ${param.brand}</p>
    <p>Model: ${param.model}</p>
    <p>Type: ${param.productType}</p>
    <p>Size: ${param.size}</p>
</div>`;

  const modal = picoModal(html);

  modal.show();
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

function sendEnquiryRequest(body) {
  const form = document.querySelector('.enquiry-section form');
  const spinner = document.querySelector('.loading-spinner');
  form.style.display = 'none';
  spinner.style.display = 'block';

  return firebase
    .auth()
    .currentUser
    .getIdToken()
    .then((idToken) => {
      const authorization = `Bearer ${idToken}`;
      console.log('authorization', authorization);
      console.log('body', body);

      const init = {
        body: JSON.stringify(body),
        method: 'POST',
        headers: {
          'Authorization': authorization,
          'Content-Type': 'application/json',
        },
      };

      return fetch('https://api2.growthfile.com/api/enquiry', init);
    })
    .then((response) => response.json())
    .then((data) => {
      console.log('success', data);

      const para = document.querySelector('.enquiry-success-message');

      spinner.style.display = 'none';
      para.style.display = 'block';
    })
    .catch(console.error);
};

function validateEnquiry(enquiry) {
  if (!enquiry.name) {
    return {
      valid: false,
      message: 'Name is required',
    };
  }

  if (!enquiry.email) {
    return {
      valid: false,
      message: 'Email is required',
    };
  }

  if (!enquiry.email.match(/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/)) {
    return {
      valid: false,
      message: 'Invalid email',
    };
  }

  if (!enquiry.companyName) {
    return {
      valid: false,
      message: 'Company name is required',
    };
  }

  if (!enquiry.phoneNumber) {
    return {
      valid: false,
      message: 'Phone Number is required',
    };
  }

  if (!enquiry.enquiryText) {
    return {
      valid: false,
      message: 'Your enquiry is empty',
    };
  }

  return {
    valid: true,
    message: null,
  };
}


function handleEnquiry(event) {
  event.preventDefault();

  const nameInput = document.getElementsByName('person-name')[0];
  const emailInput = document.getElementsByName('person-email')[0];
  const phoneNumberInput = document.getElementsByName('person-phone-number')[0];
  const personCompanyNameInput = document.getElementsByName('person-company-name')[0];
  const enquiryTextArea = document.getElementsByName('text-area')[0];
  const enquiryObject = {
    name: nameInput.value,
    email: emailInput.value,
    phoneNumber: phoneNumberInput.value,
    enquiryText: enquiryTextArea.value,
    companyName: personCompanyNameInput.value,
  };

  const validationResult = validateEnquiry(enquiryObject);

  console.log('valid', validationResult.valid, enquiryObject);

  if (!validationResult.valid) {
    return showToast(validationResult.message);
  }

  if (!firebase.auth().currentUser) {
    localStorage.setItem('enquiryObject', JSON.stringify(enquiryObject));

    console.log('not logged in');

    const modalContent = `<div id="firebaseui-auth-container"></div>`;
    firebaseAuthModal = picoModal(modalContent);
    firebaseAuthModal.show();

    ui.start('#firebaseui-auth-container', uiConfig);

    return;
  }

  const currentUser = firebase.auth().currentUser;
  const authUpdate = {};

  if (nameInput.value && currentUser.name !== nameInput.value) {
    authUpdate.display = nameInput.value;
  }

  console.log('dataset', document.body.dataset);

  const body = {
    enquiryText: enquiryTextArea.value,
    office: document.body.dataset.slug,
    companyName: personCompanyNameInput.value,
    timestamp: Date.now(),
  };

  return sendEnquiryRequest(body);
}

const formSubmitAElem = document.querySelector('.form-submit-button');

formSubmitAElem.addEventListener('click', handleEnquiry);

window
  .onload = function () {
    initMap();
  };
