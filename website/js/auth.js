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

  messageNode.classList.add('hidden');
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

      if (!window.showFullLogin) return Promise.resolve();

      return user.updateProfile({
        displayName: getName()
      })

    })
    .then(function () {
      const value = getQueryString('redirect_to');
      if (value) {
        window.location.href = value;
        return;
      }
      const user = firebase.auth().currentUser;

      if (window.showFullLogin) {
        user.updateEmail(getEmail()).then(function () {
          user.sendEmailVerification().then(function () {
            submitButton.classList.add('hidden')
            setMessage('Verification Email has been sent to ' + getEmail() + ' . Please Verify Your Email to continue.')
            document.querySelector('.container form').appendChild(getSpinnerElement())
          }).catch(function (error) {
            setMessage(error.message)
          })
        }).catch(function (error) {
          setMessage(error.message)
        })
        return;
      }
      window.location.reload();
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

  return sendApiRequest(
    `${getUserBaseUrl}/?phoneNumber=${encodeURIComponent(phoneNumber)}`,
    null,
    'GET'
  )
    .then(function (response) {
      if (!response.ok) {
        // messageNode.innerText = 'Something went wrong';
        setMessage('Something went wrong');

        console.log('Rejected:', response);

        return null;
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
