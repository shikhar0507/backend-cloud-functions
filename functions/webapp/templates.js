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
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script src="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.js"></script>
  <script>mdc.autoInit()</script>
  <script src="https://www.youtube.com/iframe_api"></script>`;


const officeSource = () => {
  const source = `
<!DOCTYPE html>
<html lang="en" itemscope itemtype="https://schema.org/Article">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <meta itemprop="name" content="{{pageTitle}}">
  <meta itemprop="description" content="{{pageDescription}}">
  <meta itemprop="image" content="{{mainImageUrl}}">
  
  <meta name="theme-color" content="#4285f4">
  <meta name="description" content="{{pageDescription}}">
  <meta name="robots" content="index,follow">
  
  <meta name="googlebot" content="index,follow">
  <meta name="google-site-verification" content="">
  <meta name="msvalidate.01" content="">

  <meta name="mobile-web-app-capable" content="yes">
  <meta name="google-play-app" content="app-id=com.growthfile.growthfileNew">
  <link rel="alternate" href="android-app://com.growthfile.growthfileNew">

  
  <meta property="fb:app_id" content="">
  <meta property="og:url" content="{{cannonicalUrl}}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{{pageTitle}}">
  <meta property="og:image" content="{{mainImageUrl}}">
  <meta property="og:description" content="{{pageDescription}}">
  <meta property="og:site_name" content="Growthfile">
  <meta property="og:locale" content="en_US">
  <meta property="article:author" content="{{officeName}}">
  
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@growthfile">
  <meta name="twitter:creator" content="@growthfile">
  <meta name="twitter:url" content="{{cannonicalUrl}}">
  <meta name="twitter:title" content="{{pageTitle}}">
  <meta name="twitter:description" content="{{pageDescription}}">
  <meta name="twitter:image" content="{{mainImageUrl}}">

  <!--UC Browser-->
  <meta name="screen-orientation" content="landscape/portrait">
  <meta name="imagemode" content="force">
  <meta name="wap-font-scale" content="no">
  <meta name="layoutmode" content="fitscreen">
  
  <link rel="canonical" href="{{cannonicalUrl}}">
  <link rel="author" href="humans.txt">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/meyer-reset/2.0/reset.min.css" integrity="sha256-gvEnj2axkqIj4wbYhPjbWV7zttgpzBVEgHub9AAZQD4=" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/brands.css" integrity="sha384-BKw0P+CQz9xmby+uplDwp82Py8x1xtYPK3ORn/ZSoe6Dk3ETP59WCDnX+fI1XCKK" crossorigin="anonymous">
<link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/fontawesome.css" integrity="sha384-4aon80D8rXCGx9ayDt85LbyUHeMWd3UiBaWliBlJ53yzm9hqN21A+o1pqoyK04h+" crossorigin="anonymous">


  <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css?family=Palanquin" rel="stylesheet">
  <link rel="stylesheet" href="css/office.css">

  <title>Growthfile - {{officeName}}</title>
</head>
<body data-slug={{slug}}>
  <header>
    <section class="header-section-start">
      <a id="logo" href="/">
        <img src="img/logo-main.jpg">
        <span>Growthfile</span>
      </a>
    </section>
    <section class="header-links">
      <a href="#" class="join-now-button">Join Now</a>
      <a href="#" class="join-now-button">Download</a>
    </section>
  </header>

  <div class="pad-after-header"></div>

  <main>
    <div class="youtube">
      <iframe fs="1" id="video-iframe" src="https://www.youtube.com/embed/{{videoId}}?enablejsapi=1" allow="fullscreen">
      </iframe>
    </div>
    
    <div class="content">
      <h1>{{pageTitle}}</h1>
      <p>{{aboutOffice}}</p>
    </div>
  </main>

  {{#if displayBranch}}
  <section class="branch-section">
    <h2>Branches</h2>
    <div class="box">
      <div class="branch-list-container">
      {{#each branchObjectsArray}}
        <ul>
          <li class="list-item" data-latitude="{{this.latitude}}" data-longitude="{{this.longitude}}">
            <span class="list-item-main">{{this.name}}</span>  
            <span class="list-item-child">{{this.address}}</span>
            <hr>
          </li>
        {{/each}}
        </ul>
      </div>
      <div id="map"></div>
    </div>
  </section>
  {{/if}}

  
  {{#if displayProducts}}
    <section class="product-section"></section>
  {{/if}}

  <section class="enquiry-section"></section>
  
  <footer>
    <div class="footer-container">
      <div class="footer-links">
        <div class="footer-link-heading">Company</div>
      </div>
      <div class="footer-links">
        <div class="footer-link-heading">Follow Us</div>
          <ul>
            <li class="social-icon">
            <a href="#" target="_blank">
                <i class="fab fa-facebook fa-2x"></i>
              </a>
            </li>
            <li class="social-icon">
            <a href="https://twitter.com/growthfile" target="_blank">
              <i class="fab fa-twitter fa-2x"></i>
              </a>
            </li>
            <li class="social-icon">
              <a href="https://angel.co/growthfile" target="_blank">
              <i class="fab fa-angellist fa-2x"></i>
              </a>
            </li>
            <li class="social-icon">
              <a href="#">
              <i class="fab fa-linkedin-in fa-2x"></i>
              </a>
            </li>
          </ul>
      </div>
      <div class="footer-links footer-about-growthfile">
        <img src="img/logo-main.jpg" alt="growthfile-logo">
        <div class="footer-link-heading">Growthfile</div>
        <div class="footer-page-links">
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
        </div>
        <span>Copyright © 2019 Growthfile Analytics, Inc. All rights reserved.</span>
      </div>
    </div>
  </footer>

  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script src="https://www.youtube.com/iframe_api"></script>
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

const joinPageSource = () => {
  const source = `
<!DOCTYPE html>
<html lang="en">
<head>
  ${metaHead}
  <link rel="stylesheet" href="css/join.css">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Growthfile Home</title>
</head>
<body>
  <h1>Join Page</h1>
  ${jsScripts}
  <script src="js/join.js"></script>
</body>
</html>`;

  return source;
};

module.exports = {
  joinPageSource,
  officeSource,
  homeSource,
};
