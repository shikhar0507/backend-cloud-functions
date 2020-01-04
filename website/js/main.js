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

function handleRecaptcha(callbackFunction) {
  return new firebase.auth.RecaptchaVerifier("recaptcha-container", {
    size: "normal",
    callback: function(response) {
      if (typeof callbackFunction === "function") {
        callbackFunction(response);
      }
    }
  });
}

function isValidPhoneNumber(phoneNumber = "") {
  if (phoneNumber.length < 5) return false;

  const pattern = /^\+[0-9\s\-\(\)]+$/;

  return phoneNumber.search(pattern) !== -1;
}

function getParsedCookies() {
  const cookieObject = {};

  document.cookie.split(";").forEach(cookie => {
    const parts = cookie.split("=");

    cookieObject[parts.shift().trim()] = decodeURI(parts.join("="));
  });

  return cookieObject;
}

function isNonEmptyString(string) {
  return typeof string === "string" && string.trim() !== "";
}

function insertAfterNode(currentNode, nodeToInsert) {
  currentNode.parentNode.insertBefore(nodeToInsert, currentNode.nextSibling);
}

function logoutUser(event) {
  event.preventDefault();

  /** User isn't logged in */
  if (!firebase.auth().currentUser) return;

  console.log("logging out user...");

  document.cookie = `__session=`;

  return firebase
    .auth()
    .signOut()
    .then(function() {
      sessionStorage.clear();
      window.location.reload();

      return;
    })
    .catch(console.error);
}

function getWarningNode(textContent) {
  // valid = false;

  const warningNode = document.createElement("span");
  warningNode.classList.add("warning-label");
  warningNode.textContent = textContent;

  return warningNode;
}

function getQueryString(field, url) {
  const href = url ? url : window.location.href;
  const reg = new RegExp("[?&]" + field + "=([^&#]*)", "i");
  const string = reg.exec(href);

  return string ? string[1] : null;
}

function getMobileOperatingSystem() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) {
    return "Windows Phone";
  }

  if (/android/i.test(userAgent)) {
    return "Android";
  }

  // iOS detection from: http://stackoverflow.com/a/9039885/177710
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return "iOS";
  }

  return "unknown";
}

function isValidEmail(emailString) {
  return /^([A-Za-z0-9_\-\.])+\@([A-Za-z0-9_\-\.])+\.([A-Za-z]{2,4})$/.test(
    emailString
  );
}

function getSpinnerElement(id) {
  const elem = document.createElement("div");
  elem.className = "spinner";
  elem.style.position = "relative";
  elem.style.height = "40px";
  elem.style.width = "40px";

  if (id) {
    elem.id = id;
  }
  return {
    center: function() {
      elem.classList.add("spinner-center");
      return elem;
    },
    default: function() {
      return elem;
    }
  };
}

/** Create Modal box */
function createModal(actionContent) {
  if (document.getElementById("modal")) {
    // document.getElementById('modal').remove();
    setContentInModal(
      actionContent,
      document.querySelector("#modal .action-container")
    );
    return;
  }

  const div = document.createElement("div");
  div.className = "modal";
  div.id = "modal";

  const content = document.createElement("div");
  content.className = "modal-content";

  const close = document.createElement("span");
  close.className = "close fa fa-window-close";
  close.onclick = function() {
    div.remove();
  };
  content.appendChild(close);

  const actionContainer = document.createElement("div");
  actionContainer.className = "action-container mt-10";
  const actionNotification = document.createElement("p");
  actionNotification.id = "action-label";
  content.appendChild(actionNotification);
  setContentInModal(actionContent, actionContainer);
  content.appendChild(actionContainer);
  div.appendChild(content);
  return div;
}

function addOptionToSelect(data, el, defaultValue) {
  data.forEach(function(name) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    el.appendChild(option);
  });
  if (defaultValue) el.value = defaultValue;
}

function isDomElementString(el) {
  return typeof el == "string";
}

function setContentInModal(el, parent) {
  if (isDomElementString(el)) {
    parent.innerHTML = el;
  } else {
    parent.appendChild(el);
  }
}

function setMessage(message) {
  const messageNode = document.getElementById("message");
  messageNode.innerText = message;
  messageNode.classList.remove("hidden");
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject("Geolocation is Not Supported");
    }

    navigator.geolocation.getCurrentPosition(function(position) {
      return resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      });
    });
  }).catch(function(error) {
    let message;
    switch (error.code) {
      case 1:
        message = "Please Enable Location";
        break;
      default:
        message = error.message;
    }

    return reject(message);
  });
}

function sendApiRequest(apiUrl, requestBody = null, method = "GET") {
  const init = {
    method,
    mode: "cors",
    cache: "no-cache",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getParsedCookies().__session}`
    }
  };

  if (requestBody && init.method !== "GET") {
    init.body = JSON.stringify(requestBody);
  }

  showProgressBar();
  console.log(requestBody);
  return fetch(apiUrl, init)
    .then(function(result) {
      hideProgressBar();

      return result;
    })
    .catch(console.error);
}

function removeAllChildren(element) {
  if (!element || !element.firstChild) return;

  while (element.firstChild) {
    element.firstChild.remove();
  }
}
document.addEventListener("click", event => {
  if (event.target === document.getElementById("form-submit-button")) {
    return void startOfficeCreationFlow(event);
  }

  if (event.target === document.getElementById("load-map-button")) {
    return getLocation()
      .then(initMap)
      .catch(function(message) {
        if (document.getElementById("map")) {
          document.getElementById(
            "map"
          ).innerHTML = `<p style='text-align:center;margin-top:20px;' class='warning-label'>${message}</p>`;
        }
      });
  }

  // TODO: Refactor this name. Not very unique and might cause conflicts.
  if (
    Array.from(document.querySelectorAll(".list-item")).includes(event.target)
  ) {
    return void updateMapPointer(event);
  }

  if (event.target === document.querySelector("#header-hamburger-icon")) {
    document.querySelector("aside").classList.toggle("hidden");
  }

  if (event.target === document.getElementById("menu-logout-link")) {
    return void logoutUser(event);
  }
});

firebase.auth().onAuthStateChanged(function(user) {
  if (user) return;

  document.cookie = `__session=`;

  console.log("no session cookie");
});

function setGlobals() {
  const result = sessionStorage.getItem("__url_config");

  function attachKeysToWindow(result) {
    Object.keys(result).forEach(function(key) {
      window[key] = result[key];
    });
  }

  if (result) {
    const parsed = JSON.parse(result);

    return attachKeysToWindow(parsed);
  }

  return fetch("/config")
    .then(function(response) {
      return response.json();
    })
    .then(function(result) {
      sessionStorage.setItem("__url_config", JSON.stringify(result));

      attachKeysToWindow(result);
    })
    .catch(console.error);
}

function checkDnt() {
  const dntEnabled = navigator.doNotTrack === 1;

  console.log({
    dntEnabled
  });
}

function addUnderlineToElement(elem) {
  elem.style.backgroundImage =
    "linear-gradient(transparent, transparent 5px, #c9cacc 5px, #c9cacc)";
  elem.style.backgroundPosition = "bottom";
  elem.style.backgroundSize = "100% 10px";
  elem.style.backgroundRepeat = "repat-x";
}

function removeUnderlineFromElement(elem) {
  elem.style.background = "unset";
}

function storeEvent() {
  // Data is not set
  if (!window.__trackingData) {
    throw new Error("__trackingData not set.");
  }

  const requestBody = {
    timestamp: Date.now(),
    cookies: document.cookie,
    url: location.href,
    officePage: document.body.dataset.slug || null
  };

  return sendApiRequest("/json?action=track-view", requestBody, "POST")
    .then(function(result) {
      return result.json();
    })
    .then(function(result) {
      console.log("track-view:", result);

      // Delte this data
      delete window.__trackingData;

      return;
    })
    .catch(console.error);
}

function handleTrackView() {
  if (!firebase.auth().currentUser) {
    return firebase
      .auth()
      .signInAnonymously()
      .then(function(user) {
        console.log("Anonymous:", user);

        return storeEvent(event);
      })
      .catch(console.error);
  }

  return storeEvent(event);
}

const loginButton = document.getElementById("login-button");

if (loginButton) {
  loginButton.onclick = function() {
    window.location.href = "/auth";
  };
}

function showProgressBar() {
  const bar = document.getElementById("progressBar");

  bar.classList.add("visible");
}

function hideProgressBar() {
  const bar = document.getElementById("progressBar");

  bar.classList.remove("visible");
}

function closeModal() {
  document.body.style.overflowY = "auto";
  const modalContainer = document.querySelector("#modal-container");

  if (modalContainer) modalContainer.remove();
}

function getModal(options) {
  /** Close existing modal */
  closeModal();

  const title = options.title;
  const modalContainer = document.createElement("div");
  modalContainer.id = "modal-container";
  modalContainer.style.zIndex = "999";
  const modalDialog = document.createElement("div");
  modalDialog.classList.add("modal-dialog");
  modalDialog.classList.add("flexed-column", "flexed-ai-center");
  const modalContent = document.createElement("div");
  modalContent.classList.add("modal-content");

  const modalHeader = document.createElement("div");
  // modalHeader.style.padding = '24px 24px 0';
  modalHeader.classList.add("modal-header", "bg-magenta");
  modalHeader.classList.add("flexed-row");
  modalHeader.style.flexDirection = "row";
  modalHeader.style.justifyContent = "space-between";

  const modalTitle = document.createElement("h3");
  modalTitle.style.fontSize = "30px;";
  modalTitle.textContent = title;
  modalTitle.style.fontWeight = "800";
  const crossIcon = document.createElement("i");

  crossIcon.textContent = "X";
  crossIcon.classList.add("close", "cur-ptr");

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(crossIcon);

  const modalBody = document.createElement("div");
  modalBody.style.maxHeight = "50vh";
  modalBody.style.overflowY = "auto";

  modalBody.appendChild(options.modalBodyElement);

  function deleteModal() {
    document.body.style.overflowY = "auto";
    modalContainer.remove();
  }

  crossIcon.onclick = deleteModal;

  const img = document.createElement("img");
  img.style.width = "100%";
  img.src = "img/modal-hero.jpg";
  img.style.webkitFilter = "grayscale(100%)";
  img.style.filter = "grayscale(100%)";
  modalContent.append(modalHeader, modalBody);
  // modalContent.appendChild(modalBody);
  modalDialog.appendChild(modalContent);
  modalContainer.appendChild(modalDialog);
  document.body.style.overflowY = "hidden";

  function onEscPress(event) {
    if (event.keyCode === 27) {
      document.body.removeEventListener("keydown", onEscPress);

      deleteModal();
    }
  }

  document.body.addEventListener("keydown", onEscPress);

  return modalContainer;
}

//todo : param should be input value not id
function getPhoneNumber(id) {
  const inputValue = document.getElementById(id).value;
  return formatPhoneNumber(inputValue);
}

function formatPhoneNumber(value) {
  if (value.startsWith(`+${window.countryCode}`)) return value;

  return `+${window.countryCode}${value}`;
}

function initializeTelInput(inputElement) {
  /** Is already initialized. */
  if (inputElement.dataset.intlInitialized) {
    return;
  }

  inputElement.style.width = "100%";

  /** Avoids multiple initializations of the same input field */
  inputElement.dataset.intlInitialized = true;
  inputElement.type = "tel";

  intlTelInput(inputElement, {
    preferredCountries: ["IN", "NP"],
    initialCountry: "IN",
    nationalMode: false,
    formatOnDisplay: true,
    customContainer: "mb-16 mt-16 mw-100",
    separateDialCode: true,
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
  });
}

setGlobals();

firebase.auth().addAuthTokenListener(function(idToken) {
  if (!idToken) {
    return;
  }

  const EXPIRY = 3600000 * 24 * 14; // 14 days
  document.cookie =
    `__session=${idToken};` + `max-age=${idToken ? EXPIRY : 0};`;

  console.log("new cookie set");
});

window.addEventListener("__trackView", handleTrackView);

/* This is a prototype */
const createSnackbar = (function() {
  // Any snackbar that is already shown
  let previous = null;

  return function(message, actionText, action) {
    if (previous) {
      previous.dismiss();
    }
    const snackbar = document.createElement("div");
    snackbar.className = "paper-snackbar";
    snackbar.dismiss = function() {
      this.style.opacity = 0;
    };
    const text = document.createTextNode(message);

    snackbar.appendChild(text);
    if (actionText) {
      if (!action) {
        action = snackbar.dismiss.bind(snackbar);
      }

      const actionButton = document.createElement("button");
      actionButton.className = "action";
      actionButton.innerHTML = actionText;
      actionButton.addEventListener("click", action);
      snackbar.appendChild(actionButton);
    }

    setTimeout(
      function() {
        if (previous === this) {
          previous.dismiss();
        }
      }.bind(snackbar),
      5000
    );

    snackbar.addEventListener(
      "transitionend",
      function(event, elapsed) {
        if (event.propertyName === "opacity" && this.style.opacity == 0) {
          this.parentElement.removeChild(this);
          if (previous === this) {
            previous = null;
          }
        }
      }.bind(snackbar)
    );

    previous = snackbar;
    document.body.appendChild(snackbar);
    // In order for the animations to trigger, I have to force the original style to be computed, and then change it.
    getComputedStyle(snackbar).bottom;
    snackbar.style.bottom = "0px";
    snackbar.style.opacity = 1;
  };
})();
