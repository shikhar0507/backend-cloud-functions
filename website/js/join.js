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

document
  .getElementById('step-1-submit')
  .onclick = function (event) {
    console.log('submit');

    const officeName = document.getElementById('officeName');
    const userEmail = document.getElementById('email');
    const userPhoneNumber = document.getElementById('phoneNumber');
    const adminContact = document.getElementById('adminPhoneNumber');
    const tocCheckbox = document.getElementById('toc-checkbox');

    // Admin contact is not required
    if (!officeName.value
      || !userEmail.value
      || !userPhoneNumber.value) {
      console.log(
        officeName.value,
        userEmail.value,
        userPhoneNumber.value,
        adminContact.value
      );

      return false;
    }

    if (!tocCheckbox.checked) {
      console.log('checkbox not ticked');

      return;
    }

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
        'Second Contact': adminContact.value || '',
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
      .querySelector('#form')
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
      })
      .catch(console.error);
  };

document
  .querySelector('#someone-else-radio')
  .addEventListener('change', function (event) {
    document
      .getElementById('other-person-phone-container')
      .classList
      .toggle('hidden');

    document
      .getElementById('me-radio')
      .checked = false;
  });

document
  .querySelector('#me-radio')
  .addEventListener('change', function (event) {
    document
      .getElementById('other-person-phone-container')
      .classList
      .add('hidden');

    document
      .getElementById('someone-else-radio')
      .checked = false;
  });

document
  .querySelector('#header-join-link')
  .style
  .display = 'none';
