function sendRequest(requestBody) {
  // const requestUrl = 'https://api2.growthfile.com/api/admin/bulk';
  // const requestUrl =
  // 'https://us-central1-growthfilev2-0.cloudfunctions.net/api/create-office';

  const requestUrl = 'http://localhost:5001/growthfilev2-0/us-central1/api/admin/bulk';
  const init = {
    method: 'POST',
    body: JSON.stringify(requestBody),
    headers: {
      'Content-Type': 'application/json',
    },
  };

  console.log('request sent', requestBody);

  return firebase
    .auth()
    .currentUser
    .getIdToken()
    .then((idToken) => {
      init.headers['Authorization'] = `Bearer ${idToken}`;

      return fetch(requestUrl, init);
    })
    .then((response) => response.json())
    .catch(console.error);
};

function handleFormStep1(event) {
  console.log('submit');

  // user-phone-number
  const officeName = document.getElementById('office-name').value;
  const userEmail = document.getElementById('user-email').value;
  const userPhoneNumber = document.getElementById('user-phone-number').value;
  const tocCheckbox = document.getElementById('tos-checkbox');

  // Admin contact is not required
  if (!officeName) {
    return showToast(`Office name is required`);
  }

  if (!userEmail) {
    return showToast(`Email is required`);
  }

  if (!userPhoneNumber) {
    return showToast(`Phone number is required`);
  }

  if (!tocCheckbox.checked) {
    return showToast(`Please agree with the TOS`);
  }

  console.log({ officeName, userEmail, userPhoneNumber });

  if (!firebase.auth().currentUser) {
    // not logged in
    console.log('not logged in');

    const modalContent = `<div id="firebaseui-auth-container"></div>`;
    // ui.
    firebaseAuthModal = picoModal(modalContent);
    firebaseAuthModal.show();

    ui.start('#firebaseui-auth-container', uiConfig);

    return;
  }

  console.log('logged in');

  if (!firebase.auth().currentUser.email) {
    document
      .getElementById('display-email')
      .innerText = userEmail;

    document
      .getElementById('form-step-2')
      .classList
      .remove('hidden');

    return firebase
      .auth()
      .currentUser
      .updateProfile({
        email: userEmail
      })
      .then((userRecord) => {
        if (userRecord.emailVerified) {
          return null;
        }

        return firebase
          .auth()
          .currentUser
          .sendEmailVerification();
      })
      .then(() => {
      })
      .catch(console.error);
  }


  const officeRequestBody = {
    geopoint: {
      latitude: 12.12121,
      longitude: 23.232323,
    },
    timestamp: Date.now(),
    template: 'office',
    data: [{
      'Name': officeName.value,
      Description: '',
      'Video Id': '',
      'GST Number': '',
      'First Contact': userPhoneNumber.value,
      'Second Contact': '',
      'Timezone': moment.tz.guess(),
      'Head Office': '',
      'Date Of Establishment': '',
      'Trial Period': '',
    }],
  };

  document
    .querySelector('.form-step-1')
    .style
    .display = 'none';

  const spinner = getSpinnerElement();

  document
    .getElementById('form')
    .appendChild(spinner);

  return sendRequest(officeRequestBody)
    .then((json) => {
      spinner
        .style
        .display = 'none';

      document
        .querySelector('.form-step-2')
        .classList
        .toggle('hidden');

      return;
    })
    .catch(console.error);
};

document
  .getElementById('form-step-1-submit')
  .onclick = handleFormStep1;

document
  .getElementById('self-upload-checkbox')
  .onchange = function (event) {
    document
      .getElementById('other-person-checkbox')
      .checked = false;
    document
      .getElementById('other-person-input')
      .setAttribute('disabled', true);
  };

document
  .getElementById('other-person-checkbox')
  .onchange = function (event) {
    document
      .getElementById('other-person-input')
      .removeAttribute('disabled');

    document
      .getElementById('self-upload-checkbox')
      .checked = false;
  };


document
  .querySelector('#header-join-link')
  .style
  .display = 'none';
