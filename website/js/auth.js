function getName() {
  return document.getElementsByName('auth-name')[0].value;
}

function getEmail() {
  return document.getElementsByName('auth-email')[0].value;
}

function getOtp() {
  return document.getElementsByName('otp')[0].value;
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

function logInWithOtp(confirmationResult) {

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
            document.querySelector('.container form').appendChild(getSpinnerElement().default())
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
  const phoneNumber = getPhoneNumber('phone');
  const appVerifier = window.recaptchaVerifier;
  return new Promise(function (resolve, reject) {

    return firebase
      .auth()
      .signInWithPhoneNumber(phoneNumber, appVerifier)
      .then(function (confirmationResult) {
        return resolve(confirmationResult)
      })
      .catch(function (error) {
        return reject(error)
      });
  })
}


function fetchAuth() {
  const phoneNumber = getPhoneNumber('phone');

  console.log({ phoneNumber });

  if (!isValidPhoneNumber(phoneNumber)) {
    setMessage('Invalid phone number');

    return;
  }

  document
    .getElementById('phone')
    .setAttribute('disabled', true);

  let rejectionMessage = '';
  const init = {
    method: 'GET',
    mode: 'cors',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return fetch(
    `${getUserBaseUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`,
    init
  )
    .then(function (response) {
      console.log('URL:', `${getUserBaseUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`);
      // if (!response.ok) {
      //   setMessage('Something went wrong');

      //   console.log('Rejected:', response);

      //   return Promise.resolve();
      // }

      return response.json();
    })
    .then(function (result) {
      if (!result) {
        return Promise.resolve();
      }

      if (!result.success) {
        rejectionMessage = result.message;

        setMessage(rejectionMessage);

        return Promise.resolve();
      }

      console.log('response received', result);

      if (result.showFullLogin) {
        window.showFullLogin = true;
        console.log('full login shown');
        showNameEmailContainer();
      }
      window.recaptchaVerifier = handleRecaptcha();

      /** Render recaptcha */
      return window.recaptchaVerifier.render();
    })
    .then(function (widgetId) {
      if (widgetId === undefined) {
        return Promise.resolve();
      }

      submitButton.classList.add('hidden')
      window.recaptchaWidgetId = widgetId;

      window.recaptchaVerifier.verify().then(function () {
        window.recaptchaResolved = true
        sendOtpToPhoneNumber().then(function (confirmResult) {
          setMessage(`Otp sent to ${phoneNumber}`);
          showOtpInput();
          document
            .getElementById('recaptcha-container')
            .style
            .display = 'none';
          submitButton.classList.remove('hidden')
          submitButton.onclick = function () {
            logInWithOtp(confirmResult)
          }
        });
      });

      console.log('recaptcha rendered');
    })
    .catch(function (error) {
      console.error(error);
      window.recaptchaResolved = false
      setMessage(rejectionMessage || 'Something went wrong');
    });
}

submitButton.onclick = fetchAuth;

window.intlTelInput(document.querySelector('#phone'), {
  preferredCountries: ['IN', 'NP'],
  initialCountry: 'IN',
  // nationalMode: false,
  separateDialCode: true,
  // formatOnDisplay: true,
  autoHideDialCode: true,
  customPlaceholder: function (selectedCountryPlaceholder, selectedCountryData) {
    window.countryCode = selectedCountryData.dialCode;
    console.log({ selectedCountryPlaceholder, selectedCountryData });
    return "e.g. " + selectedCountryPlaceholder;
  }
});
