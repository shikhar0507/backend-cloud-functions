'use strict';

/* eslint-disable */

const metaHead = `
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
{{#if officeName}}
  <meta property="article:author" content="{{officeName}}">
{{/if}}

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
<link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/brands.css" integrity="sha384-BKw0P+CQz9xmby+uplDwp82Py8x1xtYPK3ORn/ZSoe6Dk3ETP59WCDnX+fI1XCKK" crossorigin="anonymous">
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/all.css" integrity="sha384-fnmOCqbTlWIlj8LyTjo7mOUStjsKC4pOpQbqyi7RrhN7udi9RwhKkMHpvLbHG9Sr" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css?family=Palanquin" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/meyer-reset/2.0/reset.min.css" integrity="sha256-gvEnj2axkqIj4wbYhPjbWV7zttgpzBVEgHub9AAZQD4=" crossorigin="anonymous" />
  <link rel="stylesheet" href="css/common.css">
`;

const persistentBanner = `
<div>This is the banner...</div>
`;

const headerHtml = `
<header>
    <section class="header-section-start">
      <a id="logo" href="/">
        <img src="img/logo-main.jpg">
        <span>Growthfile</span>
      </a>
    </section>
    <section class="header-links">
      <a id="header-join-link" href="/join">
      <i class="fas fa-user-plus"></i>
        <span>Join Now</span>
      </a>
      <a id="download-app-link" href="/download">
        <i class="fas fa-download"></i>
        <span>Download</span>
      </a>
      <a href="/manage">
      <i class="fas fa-tools"></i>
      <span>Panel</span>
      </a>
    </section>
  </header>`;

const footerHtml = `
<footer>
  <section class="social-links-container">
    <div>
      <i class="fab fa-2x fa-facebook-f"></i>
    </div>
    <div>
      <i class="fab fa-2x fa-twitter"></i>
    </div>
    <div>
      <i class="fab fa-2x fa-linkedin"></i>
    </div>
  </section>

  <section>
    <span>Copyright	&copy; Growthfile. All rights reserved</span>
  </section>

  <section>
    <a href="#">About Us | </a>
    <a href="#">Privacy Policy | </a>
    <a href="#">Terms & Conditions</a>
  </section>
</footer>
  `;


const officeSource = () => {
  const source = `
<!DOCTYPE html>
<html lang="en" itemscope itemtype="https://schema.org/Article">
<head>
  
  ${metaHead}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css">
  <link rel="stylesheet" href="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.css" />
  <link rel="stylesheet" href="css/office.css">

  <title>Growthfile - {{officeName}}</title>
</head>
<body data-slug="{{officeName}}">
  ${headerHtml}
  <div class="pad-after-header"></div>

  <main class="pad">
  {{#if displayVideo}}
    <div class="youtube">
      <iframe fs="1" id="video-iframe" src="https://www.youtube.com/embed/{{videoId}}?enablejsapi=1" allow="fullscreen">
      </iframe>
    </div>
    {{/if}}
    
    <div class="content">
      <h1>{{pageTitle}}</h1>
      <p>{{aboutOffice}}</p>
      <span class="company-size-span">
        <i class="fas fa-users"></i>
        {{officeEmployeeSize}}
      </span>
    </div>
  </main>

  {{#if displayBranch}}
  <section class="branch-section pad">
    <h2>Branch Offices</h2>
    <div class="box">
      <div class="branch-list-container">
      <ul>
      {{#each branchObjectsArray}}
          <li data-latitude={{this.latitude}} data-longitude={{this.longitude}} onclick="handleBranchClick({{this.latitude}},{{this.longitude}})" class="list-item">
            <span class="list-item-main">{{this.name}}</span>
            
            {{#if this.weeklyOff}}
            <span><i class="fas fa-door-open"></i>{{this.weeklyOff}}</spam>
            {{/if}}
            
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
  <section class="product-section pad">
    <h2>Our Products</h2>
      <div class="products-container">
      {{#each productObjectsArray}}
      <div onclick="handleProductClick({{this.productDetails}})" class="product-box">
        <img class="product-image" src="img/product-placeholder.png">
        <div class="product-details-container">{{this.name}}</div>
      </div>
      {{/each}}
      </div>
    </section>
  {{/if}}

  <section class="enquiry-section">
  <form>
  <h2>Send an enquiry</h2>
      <div class="form-element">
        <input type="text" name="person-name" placeholder="John Doe"></input>
      </div>

      <div class="form-element">
        <input type="email" name="person-email" placeholder="john@gmail.com"></input>
      </div>

      <div class="form-element">
        <input type="tel" name="person-phone-number" placeholder="+1234567890"></input>
      </div>

      <div class="form-element">
        <input type="text" name="person-company-name" placeholder="Your company name"></input>
      </div>

      <div class="form-element">
        <textarea type="text" name="text-area" placeholder="Enter text here..."></textarea>
      </div>

      <div class="form-element">
        <a href="#" class="form-submit-button">
          <i class="far fa-envelope"></i>
          Send
        </a>
      </div>

      <p>By completing this form, you have read and acknowledged the <a href="#">Privacy Policy</a> and agree that <span>Growthfile Inc.</span> may contact you at the email address above.</p>
    </form>
    <p class="enquiry-success-message">Your enquiry has been sent successfully.</p>
    <div class="loading-spinner"></div>
  </section>
  
  ${footerHtml}

  <script src="https://www.youtube.com/iframe_api"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/toastify-js"></script>
  <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/picomodal/3.0.0/picoModal.min.js"></script>
  <script src="https://maps.googleapis.com/maps/api/js?key={{mapsApiKey}}"></script>
  <script type="text/javascript" src="//s7.addthis.com/js/300/addthis_widget.js#pubid=ra-5c9db267fe61c735"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.23/moment-timezone.min.js" integrity="sha256-N2YqgENxteUOHZbaUAP7QAEY3NlhNhHNrjbZ9bdFUiM=" crossorigin="anonymous"></script>
  <script src="https://www.google.com/recaptcha/api.js?render=6Ld-xJoUAAAAAE9ZVKyAp3blwB8ao8xLcUYf0TPe"></script>
  <script>
  grecaptcha.ready(function() {
      grecaptcha.execute('reCAPTCHA_site_key', {action: 'homepage'}).then(function(token) {
         ...
      });
  });
  </script>
  <script src="js/main.js"></script>
  <script src="js/office.js"></script>
</body>
</html>`;

  return source;
};

const joinPageSource = () => {
  const source = `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="css/join.css">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Growthfile Home</title>
  <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css?family=Palanquin" rel="stylesheet">
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/brands.css" integrity="sha384-BKw0P+CQz9xmby+uplDwp82Py8x1xtYPK3ORn/ZSoe6Dk3ETP59WCDnX+fI1XCKK" crossorigin="anonymous">
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/all.css" integrity="sha384-fnmOCqbTlWIlj8LyTjo7mOUStjsKC4pOpQbqyi7RrhN7udi9RwhKkMHpvLbHG9Sr" crossorigin="anonymous">
  <link rel="stylesheet" href="https://unpkg.com/purecss@1.0.0/build/pure-min.css" integrity="sha384-nn4HPE8lTHyVtfCBi5yW9d20FjT8BJwUXyWZT9InLYax14RDjBj46LmSztkmNP9w" crossorigin="anonymous">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css">
  <link rel="stylesheet" href="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/meyer-reset/2.0/reset.min.css" integrity="sha256-gvEnj2axkqIj4wbYhPjbWV7zttgpzBVEgHub9AAZQD4=" crossorigin="anonymous" />
  <link rel="stylesheet" href="css/common.css">
  <link rel="stylesheet" href="css/join.css">
</head>
<body>
${headerHtml}
<div class="pad-after-header"></div>
  <main class="container">
  <h1>Join Growthfile</h1>
  <div class="form-container">
    <form id="form" class="pure-form pure-form-stacked">
    <fieldset class="form-step-1">
      <label for="office-name">Company Name</label>
      <input id="office-name" class="pure-input-1" type="text" placeholder="Acme Corp.">
      <span class="pure-form-message">required field.</span>

      <label for="user-phone-number">Contact</label>
      <input id="user-phone-number" class="pure-input-1" type="tel" placeholder="+919087654321">
      <span class="pure-form-message">required field.</span>

      <label for="user-email">Email</label>
      <input id="user-email" class="pure-input-1" type="email" placeholder="you@site.com">
      <span class="pure-form-message">required field.</span>

      <label for="tos-checkbox" class="pure-checkbox">
        <input id="tos-checkbox" type="checkbox"> I agree to the <a href="#">Terms of Service</a>
      </label>

      <button id="form-step-1-submit" type="button" class="pure-button pure-button-primary">Next</button>
    </fieldset>

    <fieldset class="form-step-2 hidden">
      <div>We have sent an email to <span id="display-email"></span></div>
    </fieldset>

    <fieldset class="form-step-3 hidden">
    <label for="self-upload-checkbox" class="pure-checkbox">
      <input id="self-upload-checkbox" type="checkbox" checked> I'll upload the documents</a>.
    </label>

    <label for="other-person-checkbox" class="pure-checkbox">
      <input id="other-person-checkbox" type="checkbox"> Someone else will</a>.
    </label>

    <label>Other Contact</label>
    <input id="other-person-input" type="tel" placeholder="+919876554321" disabled>

    <br>

    <button id="form-step-2-submit" type="button" class="pure-button pure-button-primary">Next</button>

    </fieldset>
    </form>
    </div>
  </main>

  ${footerHtml}
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/toastify-js"></script>
  <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/picomodal/3.0.0/picoModal.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.24.0/moment.min.js" integrity="sha256-4iQZ6BVL4qNKlQ27TExEhBN1HFPvAvAMbFavKKosSWQ=" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.23/moment-timezone-with-data.min.js" integrity="sha256-15jnh2lee6Li94j6XCbw8PRzNZe29O/W9i97yXVyRmA=" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.23/moment-timezone.min.js" integrity="sha256-N2YqgENxteUOHZbaUAP7QAEY3NlhNhHNrjbZ9bdFUiM=" crossorigin="anonymous"></script>
  <script src="js/main.js"></script>
  <script src="js/join.js"></script>
</body>
</html>`;

  return source;
};

const downloadPageSource = () => {
  const source = `
  <!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Download Growthfile App</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/brands.css" integrity="sha384-BKw0P+CQz9xmby+uplDwp82Py8x1xtYPK3ORn/ZSoe6Dk3ETP59WCDnX+fI1XCKK" crossorigin="anonymous">
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/all.css" integrity="sha384-fnmOCqbTlWIlj8LyTjo7mOUStjsKC4pOpQbqyi7RrhN7udi9RwhKkMHpvLbHG9Sr" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css?family=Palanquin" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/meyer-reset/2.0/reset.min.css" integrity="sha256-gvEnj2axkqIj4wbYhPjbWV7zttgpzBVEgHub9AAZQD4=" crossorigin="anonymous" />
  <link rel="stylesheet" href="css/common.css">
  <link rel="stylesheet" href="css/download.css">
</head>
<body>
  ${headerHtml}
  <div class="pad-after-header"></div>
  <div class="container">
    <h2>Download Growthfile on your phone</h2>

    <main>
      <a id="play-store-link" href="https://play.google.com/store/apps/details?id=com.growthfile.growthfileNew" target="_blank">
        <img src="img/play-store-icon.jpg" alt="google play store icon">
      </a>
      <a id="app-store-link" href="https://itunes.apple.com/in/app/growthfile/id1441388774?mt=8" target="_blank">
        <img src="img/app-store-icon.jpg" alt="apple app store icon">
      </a>
    </main>
  </div>

  ${footerHtml}
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
  <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
  <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/toastify-js"></script>
  <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/picomodal/3.0.0/picoModal.min.js"></script>
  <script src="js/main.js"></script>
  <script src="js/download.js"></script>
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
      <link rel="stylesheet" href="css/home.css">
    </head>
    <body>
    ${persistentBanner}
    ${headerHtml}
    <div class="pad-after-header"></div>
    <main>
      <section class="hero">
        <div class="banner">
          <h2>A single app for employees of all <span>businesses.</span></h2>
          <a href="/join">Join Growthfile</a>
        </div>
      </section>
      
      <section class="section-below-hero">
        <h2>Why Growthfile?</h2>
        <p>Growthfile is the easiest way to manage all your business needs in one place. Our simple algorithm sends automated daily reports based on the tasks completed by your team.</p>
      </section>
    </main>

      ${footerHtml}
      <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-app.js"></script>
      <script src="https://www.gstatic.com/firebasejs/5.7.2/firebase-auth.js"></script>
      <script src="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.js"></script>
      <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/toastify-js"></script>
      <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/picomodal/3.0.0/picoModal.min.js"></script>
      <script src="js/main.js"></script>
      <script src="js/home.js"></script>
    </body>
    </html>`;

  return source;
};


module.exports = {
  joinPageSource,
  officeSource,
  homeSource,
  downloadPageSource,
};
