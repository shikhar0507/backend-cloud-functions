'use strict';

const metaHead =
  `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <meta name="robots" content="noindex, nofollow">
  <meta name="google-site-verification" content="">
  <meta name="msvalidate.01" content="">
  <meta name="theme-color" content="#3f51b5">
  <meta name="apple-mobile-web-app-status-bar-style" content="#3f51b5">
  <meta property="og:type" content="website">`;


const jsScripts =
  `<script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
  <script src="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.js"></script>
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script>mdc.autoInit()</script>
  <script src="https://www.youtube.com/iframe_api"></script>`;


const officeSource = () => {
  const source =
    `<!DOCTYPE html>
  <html lang="en">
  
  <head>
    ${metaHead}
    <meta property="og:url" content="https://growthfile.com/{{slug}}">
    <meta name="description" content="Your efficiency partner.">
    <title>Growthfile - {{officeName}}</title>
    <link rel="stylesheet" href="https://unpkg.com/nanoreset@3.0.1/nanoreset.min.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:500">
    <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
    <link rel="stylesheet" href="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.css">
    <link rel="stylesheet" href="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.css">
    <link rel="author" href="humans.txt">
    <link rel="icon" href="/favicon.png">
    <link rel="stylesheet" href="css/office.css">
  </head>
  
  <body class="mdc-typography" data-office="{{officeName}}">
    <header class="mdc-top-app-bar mdc-top-app-bar--fixed">
      <div class="header-row-top mdc-top-app-bar__row">
        <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-start">
          <img src="img/logo-main.jpg" class="mdc-top-app-bar__navigation-icon">
          <span class="mdc-top-app-bar__title">Growthfile</span>
        </section>
        <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-end" role="toolbar">
          <a href="https://growthfile.com" class="material-icons mdc-top-app-bar__action-item">home</a>
        </section>
      </div>
    </header>

    <div class="mdc-top-app-bar--fixed-adjust secondary-header">
      <h1 class="mdc-typography--headline1">{{officeName}}</h1>
    </div>
  
    <main class="container">
      <section>
        <div class="single-card">
          <div class="yt-video-container">
            <iframe fs="1" id="video-iframe" src="http://www.youtube.com/embed/{{videoId}}?enablejsapi=1" allow="fullscreen">
            </iframe>
          </div>
        </div>
  
        <div class="pad single-card">
          <h2 class="mdc-typography--headline2">About {{officeName}}</h2>
          <div class="pad post-data-container">
            <p class="mdc-typography--body1">{{officeDescription}}</p>
          </div>
        </div>
  
        {{#if displayBranch}}
        <div class="pad single-card">
          <h2 class="mdc-typography--headline2">Branches</h2>
          <div class="box branch-box">
            <div class="slider">
              <ul class="mdc-list">
                {{#each branchObjectsArray}}
                <li class="mdc-list-item" data-name="{{this.name}}"
                  onclick="handleBranchClick({{this.latitude}}, {{this.longitude}})">
                  <span class="mdc-list-item__text">
                    <span class="mdc-list-item__primary-text">{{this.name}}</span>
                    <span class="mdc-list-item__secondary-text">{{this.address}}</span>
                  </span>
                </li>
                {{/each}}
              </ul>
            </div>
  
            <div class="map-box" id="map"></div>
          </div>
        </div>
        {{/if}}
  
        {{#if displayProducts}}
        <div class="pad single-card">
          <h2 class="pad mdc-typography--headline2">Products</h2>
          <div class="box product-box">
            {{#each productObjectsArray}}
            <div class="pad child-card onclick="productOnClick(this)">
              <img alt="product-image" src="img/product-placeholder.png">
              <span class="mdc-typography--subtitle1">{{this.name}}</span>
              <div class="card-details-container">
                <div>Brand: {{this.brand}}</div>
                <div>Model: {{this.model}}</div>
                <div>Product Type: {{this.productType}}</div>
                <div>Size: {{this.size}}</div>
                <div>Brand: {{this.brand}}</div>
              </div>
            </div>
            {{/each}}
          </div>
        </div>
        {{/if}}
      </section>
  
      <aside class="">
        <span class="mdc-typography--subtitle1">Related</span>
  
        <div class="related-videos">
          <ul>
            <li>Video 1</li>
            <li>Video 2</li>
            <li>Video 3</li>
          </ul>
        </div>
      </aside>
    </main>
  
    <footer>
      <section>
        <div class="logo">
          <img src="img/logo-main.jpg">
        </div>
        <p class="pad footer-content mdc-typography--body1"> 
          Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book.
        </p>
      </section>
      <section>
        <ul class="footer-links">
          <li><a href="#">Privacy Policy</a></li>
          <li><a href="#">Download</a></li>
          <li><a href="#">Terms of Service</a></li>
        </ul>
      </section>
    </footer>
  
    <div class="fab-bottom-right">
      <button id="enquiry-fab" class="mdc-fab" aria-label="Short Text">
        <span class="mdc-fab__icon material-icons">short_text</span>
      </button>
    </div>
  
    <div id="enquiry-modal" class="modal">
      <div class="modal-content">
        <div class="modal-head">
          <h2 class="mdc-typography--headline2">Enquiry</h2>
        </div>
  
        <div class="modal-text-fields-container">
          <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
            <input type="text" id="name-text-field" placeholder="Your Name" class="mdc-text-field__input">
          </div>
  
          <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
            <input type="email" id="email-text-field" placeholder="Your email" class="mdc-text-field__input">
          </div>
  
          <div class="mdc-text-field text-field mdc-text-field--fullwidth mdc-text-field--no-label mdc-ripple-upgraded">
            <input type="text" id="company-name-text-field" placeholder="Your Company Name" class="mdc-text-field__input">
          </div>
  
          <div class="mdc-text-field mdc-text-field--textarea">
            <textarea id="enquiry-textarea" class="mdc-text-field__input" rows="8" cols="40"></textarea>
            <div class="mdc-notched-outline">
              <div class="mdc-notched-outline__leading"></div>
              <div class="mdc-notched-outline__notch">
                <label for="enquiry-textarea" class="mdc-floating-label">Your Enquiry</label>
              </div>
              <div class="mdc-notched-outline__trailing"></div>
            </div>
          </div>
        </div>
  
        <div class="centered">
          <button id="enquiry-submit-button" class="mdc-button mdc-button--raised">
            <i class="material-icons mdc-button__icon">send</i>
            <span class="mdc-button__label">Submit</span>
          </button>
          <div>
          </div>
        </div>
      </div>
    </div>

    <div class="hidden floating-menu">
      <button id="floating-bottombar-fab" class="mdc-fab" aria-label="Short Text">
        <span class="mdc-fab__icon material-icons">short_text</span>
      </button>
    </div>
  
    ${jsScripts}
    <script src="https://maps.googleapis.com/maps/api/js?key={{mapsApiKey}}"></script>
    <script src="js/office.js"></script>
  </body>
  
  </html>`;

  return source;
};

const homeSource = () => {
  const source =
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      ${metaHead}
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="ie=edge">
      <title>Growthfile Home</title>
    </head>
    <body>
      <h1>From function</h1>
      ${jsScripts}
      <script src="js/home.js"></script>
    </body>
    </html>`;

  return source;
};

module.exports = {
  officeSource,
  homeSource,
};
