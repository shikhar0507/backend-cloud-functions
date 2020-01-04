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

// needs to be global for gMaps to work. // See docs.
let map;
let player;

function getPhoneNumberValue() {
  return `+${window.countryCode}${document.querySelector("#phone").value}`;
}

function initMap(location, populateWithMarkers) {
  const curr = {
    lat: location.latitude,
    lng: location.longitude
  };

  document.getElementById("map").style.height = "540px";
  // calc(100vh - 198px);
  // document.getElementById('map').style.height = 'calc(100vh - 198px)';
  // document.getElementById('load-map-button').style.display = 'none';

  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 16,
    center: curr
  });

  const marker = new google.maps.Marker({
    position: curr,
    map
  });

  if (!populateWithMarkers) return;

  const allLis = document.querySelectorAll(".branch-list-container li");
  const bounds = new google.maps.LatLngBounds();

  if (allLis && allLis.length > 0) {
    allLis.forEach(function(item) {
      const marker = new google.maps.Marker({
        position: {
          lat: Number(item.dataset.latitude),
          lng: Number(item.dataset.longitude)
        },
        map
      });

      bounds.extend(marker.getPosition());
    });

    map.fitBounds(bounds);
  }
}

function handleProductClick(elem) {
  const productDescription = elem.dataset.productdescription;
  const productName = elem.dataset.productname;
  const productImage = elem.dataset.src;

  const modalHTML = `<div class="modal-div">
  <div class="modal-image">
  <img class="modal-image" src=${productImage}>
  </div>
  <div>
  <p class="product-description">${productDescription}</p>
  </div
  </div>`;

  const modalTittleHTML = `<h3>${productName}</h3>`;

  const productTitleName = document.createElement("H3");
  productTitleName.innerHTML = modalTittleHTML;
  const modalBodyElement = document.createElement("div");
  modalBodyElement.innerHTML = modalHTML;

  const modal = getModal({
    title: `${productName}`,
    modalBodyElement
  });

  document.body.appendChild(modal);
}

function handleBranchClick(latitude, longitude) {
  const position = {
    lat: Number(latitude),
    lng: Number(longitude)
  };

  if (latitude && longitude) {
    new google.maps.Marker({
      position,
      map
    });

    map.setCenter(position);
  }
}

function updateMapPointer(event) {
  initMap({
    latitude: Number(event.target.dataset.latitude),
    longitude: Number(event.target.dataset.longitude)
  });
}

function isElementVisible(el) {
  if (!el) return false;

  var rect = el.getBoundingClientRect(),
    vWidth = window.innerWidth || doc.documentElement.clientWidth,
    vHeight = window.innerHeight || doc.documentElement.clientHeight,
    efp = function(x, y) {
      return document.elementFromPoint(x, y);
    };

  // Return false if it's not in the viewport
  if (
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > vWidth ||
    rect.top > vHeight
  )
    return false;

  // Return true if any of its four corners are visible
  return (
    el.contains(efp(rect.left, rect.top)) ||
    el.contains(efp(rect.right, rect.top)) ||
    el.contains(efp(rect.right, rect.bottom)) ||
    el.contains(efp(rect.left, rect.bottom))
  );
}

function initPhoneNumberLibrary() {
  const phoneInput = document.querySelector("#phone");

  if (phoneInput) {
    const intlTelInputOptions = {
      preferredCountries: ["IN", "NP"],
      initialCountry: "IN",
      // nationalMode: false,
      separateDialCode: true,
      // formatOnDisplay: true,
      autoHideDialCode: true,
      customContainer: "height-fix-intl-phone",
      customPlaceholder: function(
        selectedCountryPlaceholder,
        selectedCountryData
      ) {
        window.countryCode = selectedCountryData.dialCode;
        console.log({
          selectedCountryPlaceholder,
          selectedCountryData
        });
        return "e.g. " + selectedCountryPlaceholder;
      }
    };

    window.intlTelInput(phoneInput, intlTelInputOptions);

    phoneInput.onblur = function() {
      // const phoneNumberValue = getPhoneNumberValue();

      validatePhoneInput();
    };
  }
}

const initMapTrigger = document.querySelector("#init-map-trigger");
const enquirySection = document.querySelector(".enquiry-section");

function handleScrollEvent() {
  /** Not all offices have branches */
  if (
    !initMapTrigger ||
    /** Only when branch section is in the viewport */
    !isElementVisible(initMapTrigger) ||
    /** No not bug the user for permission repetedly. */
    window.askedForLocationAlready
  ) {
    return;
  }

  return navigator.permissions
    .query({
      name: "geolocation"
    })
    .then(function(status) {
      window.askedForLocationAlready = true;

      if (status === "granted") return null;

      return getLocation();
    })
    .then(function(result) {
      document.querySelector("#load-map-button").classList.add("hidden");

      return initMap(result, true);
    })
    .catch(function(error) {
      const placeholderDiv = document.getElementById("load-map-button");
      placeholderDiv.classList.remove("hidden");
      document.querySelector("#load-map-button").classList.remove("hidden");

      console.warn("Location access denied", error);
    });
}

const retryButton = document.getElementById("retry-location-button");

if (retryButton) {
  retryButton.onclick = function(evt) {
    evt.preventDefault();
    console.log("Location Button clicked");

    handleScrollEvent();
  };
}

function onPlayerReady(event) {
  console.log("onPlayerReady", event);

  // event.target.playVideo();
}

function onPlayerStateChange(event) {
  function handleVideoEnded() {
    document.querySelector(".enquiry-section").scrollIntoView({
      behavior: "smooth"
    });
  }

  function handleVideoPaused() {
    console.log("Video paused");
  }

  function handleVideoPlaying() {
    console.log("Video started playing");
  }

  function handleVideoUnstarted() {
    console.log("Video unstarted");
  }

  switch (event.data) {
    case YT.PlayerState.UNSTARTED:
      handleVideoUnstarted();
      break;
    case YT.PlayerState.ENDED:
      handleVideoEnded();
      break;
    case YT.PlayerState.PAUSED:
      handleVideoPaused();
      break;
    case YT.PlayerState.PLAYING:
      handleVideoPlaying();
      break;
    default:
      console.log("Video ignoring:", event.data);
  }
}

function stopVideo() {
  player.stopVideo();
}

function onYouTubeIframeAPIReady() {
  console.log("onYouTubeIframeAPIReady");

  player = new YT.Player("ytplayer", {
    videoId: document.body.dataset.videId,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

function sendEnquiryCreationRequest() {
  // enquiry textarea should be non-empty string
  // product value can be empty
  const getProductName = function() {
    const productSelect = document.querySelector("#product-select");

    if (productSelect) return productSelect.value;

    return "";
  };

  const messageNode = document.querySelector("#form-message");
  const enquiryTextarea = document.querySelector("#enquiry-text");

  // reset
  messageNode.textContent = "";
  messageNode.classList.remove("hidden");
  messageNode.classList.add("warning-label");

  if (!isNonEmptyString(enquiryTextarea.value)) {
    messageNode.textContent = "Enquiry text cannot be empty";

    return;
  }

  messageNode.classList.add("hidden");

  const form = document.forms[0];
  const spinnerId = "form-spinner";
  const spinner = getSpinnerElement(spinnerId).default();
  const fieldsets = document.querySelectorAll("form > fieldset");

  fieldsets.forEach(function(item) {
    item.classList.add("hidden");
  });

  form.classList.add("flexed", "flexed-jc-center");
  form.style.flexDirection = "column";
  form.style.alignItems = "center";
  const buttonContainer = document.createElement("p");
  const viewEnquiriesButton = document.createElement("a");
  viewEnquiriesButton.classList.add("button", "tac");
  viewEnquiriesButton.innerText = "View Enquiries";
  viewEnquiriesButton.setAttribute("href", "/#action=view-enquiries");

  buttonContainer.appendChild(viewEnquiriesButton);

  form.appendChild(spinner);
  const responseParagraph = document.createElement("p");

  return getLocation()
    .then(function(location) {
      const requestBody = {
        timestamp: Date.now(),
        template: "enquiry",
        geopoint: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          provider: "HTML5"
        },
        office: document.body.dataset.slug,
        share: [],
        schedule: [],
        venue: [],
        attachment: {
          "Company Name": {
            type: "string",
            value: document.body.dataset.slug
          },
          Product: {
            value: getProductName(),
            type: "product"
          },
          Enquiry: {
            value: document.querySelector("#enquiry-text").value,
            type: "string"
          }
        }
      };

      console.log("Request Body:", requestBody);

      console.log("API request sent.");
      return sendApiRequest(
        `${apiBaseUrl}/activities/create`,
        requestBody,
        "POST"
      );
    })
    .then(function(response) {
      console.log("Response received:", response);
      if (response.ok) {
        responseParagraph.classList.add("success-label");
      }

      return response.json();
    })
    .then(function(json) {
      console.log("Response json:", json);

      responseParagraph.innerText = json.message;

      spinner.classList.add("hidden");

      if (json.success) {
        responseParagraph.innerText = `Enquiry created successfully`;

        localStorage.removeItem("enquiryText");
        localStorage.removeItem("productName");
      }

      form.appendChild(responseParagraph);
      form.appendChild(buttonContainer);
    })
    .catch(function(error) {
      spinner.classList.add("hidden");

      if (error === "Please Enable Location") {
        responseParagraph.classList.add("warning-label");

        responseParagraph.innerText =
          "Location access is required to send an enquiry";

        form.appendChild(responseParagraph);
      }

      console.error("Api Error", error);
    });
}

function createEnquiryActivity() {
  const messageNode = document.querySelector("#form-message");
  const enquiryTextarea = document.querySelector("#enquiry-text");
  const tcCheckbox = document.querySelector("#tc-checkbox");

  // reset
  messageNode.textContent = "";
  messageNode.classList.remove("hidden");
  messageNode.classList.add("warning-label");

  if (!isNonEmptyString(enquiryTextarea.value)) {
    messageNode.textContent = "Enquiry text cannot be empty";

    return;
  }

  if (!tcCheckbox.checked) {
    messageNode.textContent = "Please check the terms and services";

    return;
  }

  if (firebase.auth().currentUser) {
    return sendEnquiryCreationRequest();
  }

  const displayName = document.querySelector("#display-name");
  const email = document.querySelector("#email");

  if (window.fullLoginShown) {
    if (!isNonEmptyString(displayName.value)) {
      messageNode.textContent = "Name cannot be empty";

      return;
    }

    if (!isValidEmail(email.value)) {
      messageNode.textContent = "Invalid/missing email";

      return;
    }
  }

  const otp = document.querySelector("#otp");

  if (!isNonEmptyString(otp.value)) {
    messageNode.textContent = "OTP is required";

    return;
  }

  // signinwith otp and then call
  // sendEnquiryCreationRequest();

  return confirmationResult
    .confirm(otp.value)
    .then(function(result) {
      console.log("Signed in successfully.", result);

      const updates = {};
      const user = firebase.auth().currentUser;

      // .update({ displayName, email })
      // .catch(console.error);
      if (displayName !== user.displayName) {
        updates.displayName = displayName;
      }

      if (email.value !== user.email) {
        updates.email = email.value;
      }

      // async
      console.log("Auth will be updated", updates);
      user.updateProfile(updates);

      if (!user.emailVerified) {
        console.log("Email will be sent");
        // email verification sent
        // async
        user.sendEmailVerification();
      }

      return sendEnquiryCreationRequest();
    })
    .catch(function(error) {
      if (error.code === "auth/invalid-verification-code") {
        messageNode.textContent = "Wrong code";

        return;
      }

      console.error(error);
    });
}

function sendOtpToPhoneNumber() {
  const phoneNumber = getPhoneNumberValue();
  const appVerifier = window.recaptchaVerifier;

  firebase
    .auth()
    .signInWithPhoneNumber(phoneNumber, appVerifier)
    .then(function(confirmationResult) {
      document.querySelector("#otp").classList.remove("hidden");

      window.confirmationResult = confirmationResult;

      document.querySelector("#form-message").classList.remove("hidden");
      document.querySelector(
        "#form-message"
      ).textContent = `OTP sent to: ${phoneNumber}`;

      enquirySubmitButton.onclick = newEnquiryFlow;
    })
    .catch(console.error);
}

function validatePhoneInput() {
  const phoneInput = document.querySelector("#phone");
  const phoneNumber = getPhoneNumberValue();

  // nothing entered so not sending a request
  if (!phoneInput.value) return;

  if (document.querySelector("#result-container")) {
    document
      .querySelector("#result-container")
      .parentElement.removeChild(document.querySelector("#result-container"));
  }

  // p tag containing this element
  const resultContainer = document.createElement("div");
  resultContainer.id = "result-container";
  resultContainer.classList.add(
    "flexed-ai-center",
    "flexed-jc-center",
    "pad",
    "animated",
    "fadeIn"
  );

  const spinner = getSpinnerElement("phone-validator-spinner").default();
  resultContainer.appendChild(spinner);

  // const phoneContainer = document.querySelector('#phone').parentElement;
  const form = document.querySelector(".enquiry-section form");

  insertAfterNode(form, resultContainer);

  console.log("validating", phoneNumber);

  return fetch(
    `${getUserBaseUrl}?phoneNumber=${encodeURIComponent(phoneNumber)}`
  )
    .then(function(response) {
      return response.json();
    })
    .then(function(result) {
      console.log(result);
      resultContainer.removeChild(spinner);

      if (result.message) {
        resultContainer.appendChild(getWarningNode(result.message));

        document
          .querySelector("#enquiry-submit-container")
          .classList.add("hidden");
      } else {
        resultContainer.parentElement.removeChild(resultContainer);
      }

      if (result.success) {
        window.recaptchaVerifier = handleRecaptcha();
        if (result.showFullLogin) {
          document.querySelector("#email").classList.remove("hidden");
          document.querySelector("#display-name").classList.remove("hidden");
          window.fullLoginShown = true;
        }

        window.recaptchaVerifier.verify().then(function(widgetId) {
          window.recaptchaWidgetId = widgetId;
          resultContainer.remove();

          document
            .querySelector("#enquiry-submit-container")
            .classList.remove("hidden");

          document
            .getElementById("recaptcha-container")
            .classList.add("hidden");

          // const appVerifier = window.recaptchaVerifier;

          // send otp
          // make otp field visible
          // sendto

          sendOtpToPhoneNumber();

          // enquirySubmitButton.onclick = newEnquiryFlow;
        });
      }
    })
    .catch(function(error) {
      console.error("AuthRejection", error);
    });
}

function newEnquiryFlow(event) {
  event.preventDefault();
  console.log("button clicked");

  const oldWarningLabels = document.querySelectorAll("p .warning-label");

  oldWarningLabels.forEach(function(element) {
    element.parentNode.removeChild(element);
  });

  return createEnquiryActivity();
}

window.onload = function() {
  if (localStorage.getItem("enquiryText")) {
    document.getElementById("enquiry-text").value = localStorage.getItem(
      "enquiryText"
    );
  }

  if (localStorage.getItem("productName")) {
    console.log("setting productName from localstorage");

    document.getElementById("product-select").value = localStorage.getItem(
      "productName"
    );
  }

  initPhoneNumberLibrary();

  const youtube = document.querySelector(".youtube");
  console.log({
    youtube
  });

  if (!youtube) {
    console.log("setting ");
    const container = document.querySelector(".container");
    container.style.marginTop = "auto";
    document.querySelector(".pad-below-header").style.height = "20vh";
  }
};

const enquirySubmitButton = document.getElementById("enquiry-submit-button");

if (enquirySubmitButton) {
  enquirySubmitButton.onclick = newEnquiryFlow;
}

document.onscroll = handleScrollEvent;
