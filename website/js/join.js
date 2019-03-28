function sendRequest(requestBody) {
  const requestUrl = 'https://api2.growthfile.com/api/activities/createOffice';

  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return firebase
    .auth
    .currentUser()
    .getIdToken()
    .then((idToken) => {
      init.headers['Authorization'] = `Bearer ${idToken}`;

      return fetch(requestUrl, init);
    })
    .then((response) => response.json())
    .then((data) => {
      console.log('data', data);

      // hide form
      // show text that office has been created successfully.
    })
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
    if (!officeName.value || !userEmail.value || !userPhoneNumber.value) {
      console.log('values', officeName.value, userEmail.value, userPhoneNumber.value, adminContact.value);

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

    document
      .querySelector('.form-step-1')
      .style
      .display = 'none';

    document
      .querySelector('.form-step-2')
      .classList
      .toggle('hidden');

    return false;
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
