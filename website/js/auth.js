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

function showPhoneNumberInput() {
  document.getElementById('phone-number-container').classList.remove('hidden');
}

function showOtpInput() {
  document.getElementById('otp-container').classList.remove('hidden');
}

function showNameEmailContainer() {
  document.getElementById('name-email-container').classList.remove('hidden');
}

const submitButton = document.getElementById('auth-flow-start');

function hideMessage() {
  const messageNode = document.getElementById('message');

  // already hidden
  messageNode.classList.add('hidden');
}

function setMessage(message) {
  const messageNode = document.getElementById('message');
  messageNode.innerText = message;

  if (messageNode.classList.contains('hidden')) {
    messageNode.classList.remove('hidden');
  }
}

function logInWithOtp() {
  const code = getOtp();

  if (!window.recaptchaResolved) {
    setMessage('Please resolve the recaptcha');

    return;
  }

  if (!isNonEmptyString(code)) {
    setMessage('Please enter the code');

    return;
  }


  if (window.showFullLogin) {
    const displayName = getName();
    const email = getEmail();

    if (!isNonEmptyString(displayName)) {
      setMessage('Name cannot be left blank');

      return;
    }

    if (!isNonEmptyString(email)) {
      setMessage('Please enter an email');

      return;
    }

    if (!isValidEmail(email)) {
      setMessage('Invalid email');

      return;
    }
  }

  return confirmationResult
    .confirm(code)
    .then(function (result) {
      setMessage('Signin successful. Please wait...');

      console.log('Signed in successfully.', result);

      const user = firebase.auth().currentUser;

      if (!window.showFullLogin) {
        return Promise.resolve();
      }

      console.log('Updating profile', {
        name: getName(),
        email: getEmail(),
      });

      return user
        .updateProfile({
          displayName: getName(),
          email: getEmail(),
        });
    })
    .then(function () {
      const value = getQueryString('redirect_to');

      if (value) {
        window.location.href = value;

        return;
      }

      // Redirects logge in user to home page
      window.location.reload();

      return Promise.resolve();
    })
    .catch(function (error) {
      console.error(error);

      if (error.code === 'auth/invalid-verification-code') {
        setMessage('Wrong code');

        return;
      }

      grecaptcha.reset(window.recaptchaWidgetId);
    });
}

function sendOtpToPhoneNumber() {
  const phoneNumber = getPhoneNumber();
  const appVerifier = window.recaptchaVerifier;

  return firebase
    .auth()
    .signInWithPhoneNumber(phoneNumber, appVerifier)
    .then(function (confirmationResult) {
      setMessage(`Otp sent to ${phoneNumber}`);

      console.log('otp sent');

      window.confirmationResult = confirmationResult;
    })
    .catch(console.error);
}

function handleRecaptcha() {
  window
    .recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      'size': 'normal',
      'callback': function (response) {
        // reCAPTCHA solved, allow signInWithPhoneNumber.
        window.recaptchaResolved = true;

        console.log('recaptcha solved');
        showOtpInput();

        document
          .getElementById('recaptcha-container')
          .style
          .display = 'none';
      },
      'expired-callback': function () {
        console.log('recaptcha expired');

        setMessage('Recaptcha expired. Please reload the page');
      }
    });
}

function fetchAuth() {
  const phoneNumber = getPhoneNumber();

  if (!isValidPhoneNumber(phoneNumber)) {
    setMessage('Invalid phone number');

    return;
  }

  document
    .getElementsByName('auth-phone-number')[0]
    .setAttribute('disabled', true);

  const apiUrl = 'https://us-central1-growthfile-207204.cloudfunctions.net/getUser';
  const requestUrl = `${apiUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`;

  return sendApiRequest(requestUrl, null, 'GET')
    .then(function (response) {
      if (!response.ok) {
        // messageNode.innerText = 'Something went wrong';
        setMessage('Something went wrong');

        console.log('Rejected:', response);
      }

      return response.json();
    })
    .then(function (result) {
      if (!result) {
        return Promise.resolve();
      }

      console.log('response received', result);

      if (result.showFullLogin) {
        window.showFullLogin = true;
        console.log('full login shown');

        showNameEmailContainer();
      }

      firebase
        .auth()
        .settings
        .appVerificationDisabledForTesting = true;

      /** Render recaptcha */
      return recaptchaVerifier.render();
    })
    .then(function (widgetId) {
      if (widgetId === undefined) {
        return Promise.resolve();
      }


      window.recaptchaWidgetId = widgetId;
      submitButton.onclick = logInWithOtp;

      console.log('recaptcha rendered');

      return sendOtpToPhoneNumber();
    })
    .catch(function (error) {
      console.error(error);

      setMessage('Something went wrong');
    });
}

submitButton.onclick = fetchAuth;

handleRecaptcha();
