function getName() {
  return document.getElementsByName('auth-name')[0].value;
}

function getEmail() {
  return document.getElementsByName('auth-email')[0].value;
}

function getOtp() {
  return document.getElementsByName('otp')[0].value;
}

function getPhoneNumber() {
  return document.getElementsByName('auth-phone-number')[0].value;
}

function startSignInFlow() {
  const phoneNumber = getPhoneNumber();
  const appVerifier = window.recaptchaVerifier;
  const messageNode = document.getElementById('message');

  console.log('In signInflow');

  if (window.showFullLogin && !isNonEmptyString(getName())) {
    messageNode.innerText = 'Name cannot be left blank';
    messageNode.classList.remove('hidden');

    console.log('name cannot be left blank');

    return Promise.resolve();
  }

  if (window.showFullLogin && !isNonEmptyString(getEmail())) {
    messageNode.innerText = 'Email cannot be left blank';
    messageNode.classList.remove('hidden');

    console.log('Email cannot be left blank');

    return Promise.resolve();
  }

  if (window.showFullLogin && !isValidEmail(getEmail())) {
    messageNode.innerText = 'Invalid email';

    messageNode.classList.remove('hidden');

    console.log('invalid email');

    return Promise.resolve();
  }

  if (!isNonEmptyString(getOtp())) {
    messageNode.innerText = 'Invalid code';

    messageNode.classList.remove('hidden');

    console.log('invalid code');

    return Promise.resolve();
  }

  firebase
    .auth()
    .settings
    .appVerificationDisabledForTesting = true;

  return firebase
    .auth()
    .signInWithPhoneNumber(phoneNumber, appVerifier)
    .then(function (confirmationResult) {
      console.log('confirmationResult', confirmationResult);

      const code = getOtp();

      if (!code) {
        const messageNode = document.getElementById('message')
        messageNode
          .innerText = 'Invalid code';
        messageNode
          .classList
          .remove('hidden');

        return Promise.resolve();
      }

      console.log('otp sent');

      return confirmationResult.confirm(code);
    })
    .then(function (userRecord) {
      if (!userRecord) {
        return Promise.resolve();
      }

      console.log('signedIn', userRecord);

      // window.location.reload();

      const promises = [];
      const profileUpdateObject = {};
      const user = firebase.auth().currentUser;
      let toUpdateProfile = false;

      if (!user.email) {
        console.log('setting email', getEmail());

        toUpdateProfile = true;
        profileUpdateObject.displayName = getName();
      }

      if (!user.displayName) {
        console.log('setting name', getName());

        toUpdateProfile = true;
        profileUpdateObject.email = getEmail();
      }

      if (toUpdateProfile) {
        console.log('updating profile', profileUpdateObject);

        promises
          .push(user.updateProfile(profileUpdateObject));
      }

      if (!user.emailVerified) {
        console.log('sending email verification');

        promises
          .push(user.sendEmailVerification());
      }

      return Promise.all(promises);
    })
    .then(function (result) {
      if (!result) {
        return Promise.resolve();
      }

      console.log(result);

      const messageNode = document.getElementById('message');

      messageNode.innerText = 'Login success. Please wait.';
      messageNode.classList.remove('hidden');

      window.location.reload();

      return Promise.resolve();
    })
    .catch(function (error) {
      console.error(error);

      if (error.code && error.code === 'auth/invalid-verification-code') {
        const messageNode = document.getElementById('message');
        messageNode.innerText = 'Invalid verification code';
        messageNode.classList.remove('hidden');

        return;
      }

      console.error('AuthError:', error);
      // return 
    });
}


function handleAuthFlow(event) {
  console.log('function called handleAuthFlow');

  const messageNode = document.getElementById('message');

  if (document.readyState !== 'complete') {
    messageNode.innerText = 'Please wait a few seconds';

    messageNode.classList.toggle('hidden');

    return Promise.resolve();
  }

  const inputPhoneNumber = getPhoneNumber();
  const submitButton = document.getElementById('auth-phone-number-submit');

  if (!isValidPhoneNumber(inputPhoneNumber)) {
    messageNode.innerText = 'Invalid phone number';
    messageNode.classList.toggle('hidden');

    console.log('invalid phone number');

    return Promise.resolve();
  }

  const apiUrl = 'https://us-central1-growthfile-207204.cloudfunctions.net/getUser';
  const reqUrl = `${apiUrl}/?phoneNumber=${encodeURIComponent(inputPhoneNumber)}`;

  submitButton.onclick = startSignInFlow;

  /** Required in order to disable recaptcha showing again */
  submitButton.id = '';

  return sendApiRequest(reqUrl, null, 'GET')
    .then(function (response) {
      if (!response.ok) {
        // messageNode.innerText = response.json().message;
        console.log('rejected api:', response);

        return Promise.resolve();
      }

      return response.json();
    })
    .then(function (result) {
      if (!result) {
        return Promise.resolve();
      }

      if (result.showFullLogin) {
        const allFieldsets = document.querySelectorAll('fieldset');

        window.showFullLogin = true;

        /** Disable the phone number input after click */
        allFieldsets[0]
          .children[1]
          .setAttribute('disabled', true);

        document
          .querySelectorAll('fieldset')[1]
          .classList
          .toggle('hidden');

        document
          .querySelectorAll('fieldset')[2]
          .classList
          .toggle('hidden');
      }

      return Promise.resolve();
    })
    .catch(console.error);
};

function handleRecaptcha() {
  const messageNode = document.getElementById('message');
  messageNode.classList.toggle('hidden');

  window
    .recaptchaVerifier = new firebase.auth.RecaptchaVerifier('auth-phone-number-submit', {
      'size': 'invisible',
      'callback': function (response) {
        // reCAPTCHA solved, allow signInWithPhoneNumber.
        console.log('recaptcha solved');
      },
      'expired-callback': function () {
        console.log('recaptcha expired');
      }
    });

  recaptchaVerifier
    .render()
    .then(function (widgetId) {
      window.recaptchaWidgetId = widgetId;

      // console.log('recaptcha rendered');
    })
    .catch(console.error);
}

document
  .getElementById('auth-phone-number-submit')
  .onclick = handleAuthFlow;

handleRecaptcha();
