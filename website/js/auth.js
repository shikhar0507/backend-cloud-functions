/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

"use strict";

function getName() {
  return document.getElementsByName("auth-name")[0].value;
}

function getEmail() {
  return document.getElementsByName("auth-email")[0].value;
}

function getOtp() {
  return document.getElementsByName("otp")[0].value;
}

function showPhoneNumberInput() {
  document.getElementById("phone-number-container").classList.remove("hidden");
}

function showOtpInput() {
  document.getElementById("otp-container").classList.remove("hidden");
}

function hideOtpInput() {
  document.getElementById("otp-container").classList.add("hidden");
}

function showNameEmailContainer() {
  document.getElementById("name-email-container").classList.remove("hidden");
}

const submitButton = document.getElementById("auth-flow-start");
const cancelAuthFlowButton = document.getElementById("cancel-auth-flow-start");

function hideMessage() {
  const messageNode = document.getElementById("message");

  messageNode.classList.add("hidden");
}

function logInWithOtp(confirmationResult) {
  const code = getOtp();

  if (!window.recaptchaResolved) {
    setMessage("Please resolve the recaptcha");

    return;
  }

  if (!isNonEmptyString(code)) {
    setMessage("Please enter the code");

    return;
  }

  if (window.showFullLogin) {
    const displayName = getName();
    const email = getEmail();

    if (!isNonEmptyString(displayName)) {
      setMessage("Name cannot be left blank");

      return;
    }

    if (!isNonEmptyString(email)) {
      setMessage("Please enter an email");

      return;
    }

    if (!isValidEmail(email)) {
      setMessage("Invalid email");

      return;
    }
  }

  return confirmationResult
    .confirm(code)
    .then(function(result) {
      setMessage("Signin successful. Please wait...");

      console.log("Signed in successfully.", result);
      const user = firebase.auth().currentUser;

      if (!window.showFullLogin) return Promise.resolve();

      return user.updateProfile({
        displayName: getName()
      });
    })
    .then(function() {
      const value = getQueryString("redirect_to");
      if (value) {
        window.location.href = value;
        return;
      }

      const user = firebase.auth().currentUser;
      console.log(user)
      if (window.showFullLogin) {
        user
          .updateEmail(getEmail())
          .then(function() {
            user
              .sendEmailVerification()
              .then(function() {
                submitButton.classList.add("hidden");
                setMessage(
                  "Verification Email has been sent to " +
                    getEmail() +
                    " . Please Verify Your Email to continue."
                );
                document
                  .querySelector(".container form")
                  .appendChild(getSpinnerElement().default());
              })
              .catch(function(error) {
                setMessage(error.message);
              });
          })
          .catch(function(error) {
            setMessage(error.message);
          });
        return;
      }
      window.location.reload();
    })
    .catch(function(error) {
      console.error(error);

      if (error.code === "auth/invalid-verification-code") {
        setMessage("Wrong code");

        return;
      }

      grecaptcha.reset(window.recaptchaWidgetId);
    });
}

function sendOtpToPhoneNumber() {
  const phoneNumber = getPhoneNumber("phone");
  const appVerifier = window.recaptchaVerifier;
  return new Promise(function(resolve, reject) {
    return firebase
      .auth()
      .signInWithPhoneNumber(phoneNumber, appVerifier)
      .then(function(confirmationResult) {
        return resolve(confirmationResult);
      })
      .catch(function(error) {
        return reject(error);
      });
  });
}

function fetchAuth() {
  const phoneNumber = getPhoneNumber("phone");

  console.log({
    phoneNumber
  });

  if (!isValidPhoneNumber(phoneNumber)) {
    setMessage("Invalid phone number");
    return;
  }
  const phoneNumberField = document.getElementById("phone");
  phoneNumberField.setAttribute("disabled", true);

  let rejectionMessage = "";
  const init = {
    method: "GET",
    mode: "cors",
    cache: "no-cache",
    headers: {
      "Content-Type": "application/json"
    }
  };

  return fetch(
    `${getUserBaseUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`,
    init
  )
    .then(function(response) {
      console.log(
        "URL:",
        `${getUserBaseUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`
      );

      return response.json();
    })
    .then(function(result) {
      if (!result) {
        return Promise.resolve();
      }

      if (!result.success) {
        rejectionMessage = result.message;
        setMessage(rejectionMessage);

        return Promise.resolve();
      }

      console.log("response received", result);

      if (result.showFullLogin) {
        window.showFullLogin = true;
        console.log("full login shown");
        showNameEmailContainer();
      }
      window.recaptchaVerifier = handleRecaptcha();

      /** Render recaptcha */
      return window.recaptchaVerifier.render();
    })
    .then(function(widgetId) {
      if (widgetId === undefined) {
        return Promise.resolve();
      }

      submitButton.classList.add("hidden");
      window.recaptchaWidgetId = widgetId;

      window.recaptchaVerifier.verify().then(function() {
        window.recaptchaResolved = true;

        sendOtpToPhoneNumber().then(function(confirmResult) {
          setMessage(`Otp sent to ${phoneNumber}`);
          cancelAuthFlowButton.classList.remove("hidden");
          cancelAuthFlowButton.onclick = function() {
            window.location.reload();
          };

          showOtpInput();
          document.getElementById("recaptcha-container").style.display = "none";
          submitButton.classList.remove("hidden");
          submitButton.onclick = function() {
            logInWithOtp(confirmResult);
          };
        });
      });

      console.log("recaptcha rendered");
    })
    .catch(function(error) {
      console.error(error);
      window.recaptchaResolved = false;
      setMessage(rejectionMessage || "Something went wrong");
    });
}

initializeTelInput(document.querySelector("#phone"));

submitButton.onclick = fetchAuth;
