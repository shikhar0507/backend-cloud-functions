'use strict';


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
  <link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/all.css" integrity="sha384-fnmOCqbTlWIlj8LyTjo7mOUStjsKC4pOpQbqyi7RrhN7udi9RwhKkMHpvLbHG9Sr" crossorigin="anonymous">
  <link type="text/css" rel="stylesheet" href="https://cdn.firebase.com/libs/firebaseui/3.5.2/firebaseui.css" />
  <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css?family=Palanquin" rel="stylesheet">
  <link rel="stylesheet" href="css/office.css">

  <title>Growthfile - {{officeName}}</title>
</head>
<body data-slug="{{slug}}">
  <header>
    <section class="header-section-start">
      <a id="logo" href="/">
        <img src="img/logo-main.jpg">
        <span>Growthfile</span>
      </a>
    </section>
    <section class="header-links">
      <a href="https://growthfile.com/join">
      <i class="fas fa-user"></i>
      Join Now
      </a>
      <a href="https://growthfile.com/download">
        <i class="fas fa-mobile-alt"></i>
        Download
      </a>
    </section>
  </header>

  <div class="pad-after-header"></div>

  <div class="modal">
    <div class="modal-content">
      <div id="firebaseui-auth-container"></div>
    </div>
  </div>

  <main class="pad">
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
  <section class="branch-section pad">
    <h2>Branch Offices</h2>
    <div class="box">
      <div class="branch-list-container">
      <ul>
      {{#each branchObjectsArray}}
          <li data-latitude={{this.latitude}} data-longitude={{this.longitude}} onclick="handleBranchClick({{this.latitude}},{{this.longitude}})" class="list-item">
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

  <section class="enquiry-section pad">
  <form>
    <h2>Send an enquiry</h2>
      <div class="form-element">
        <input type="text" name="person-name" placeholder="John Doe"></input>
      </div>

      <div class="form-element">
        <input type="email" name="person-email" placeholder="john@gmail.com"></input>
      </div>

      <div class="form-element">
        <input type="phoneNumber" name="person-phone-number" placeholder="+1234567890"></input>
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

      <p>By completing this form, I have read and acknowledged the <a href="#">Privacy Policy</a> and agree that <span>Growthfile Inc.</span> may contact me at the email address above.</p>
    </form>
  </section>
  
  <footer>
    <div class="footer-container">
      <div class="footer-links">
        <div class="footer-link-heading">Company</div>
        <ul class="footer-page-links">
          <li>
            <a href="https://growthfile.com/about">About</a>
          </li>
          <li>
            <a href="https://growthfile.com/careers">Careers</a>
          </li>
          <li>
            <a href="https://growthfile.com/help">Help</a>
          </li>
          <li>
            <a href="https://growthfile.com/contact">Contact Us</a>
          </li>
          <li>
            <a href="https://growthfile.com/sitemap.xml">Sitemap</a>
          </li>
        </ul>
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
        <div class="footer-logo-container">
          <img src="img/logo-main.jpg" alt="growthfile-logo">
          <span class="footer-link-heading">Growthfile Inc.</span>
        </div>
        <div class="footer-page-links">
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
        </div>
        <span>Copyright © 2019 Growthfile Analytics, Inc. All rights reserved.</span>
      </div>
    </div>
  </footer>

  <script type="text/javascript" src="//s7.addthis.com/js/300/addthis_widget.js#pubid=ra-5c7f56ce7ea64f4a"></script>
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
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="ie=edge">
      <title>Growthfile Home</title>
    </head>
    <body>
      <h1>From function</h1>
      <script src="js/home.js"></script>
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
</head>
<body>
  <h1>Join Page</h1>
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
  <link rel="stylesheet" href="css/download.css">
</head>
<body>
  <header>
    
  </header>
  <div class="container">
    <h1>Download Growthfile on your phone</h1>

    <a href="https://play.google.com/store/apps/details?id=com.growthfile.growthfileNew" target="_blank">
      <img src="img/play-store-icon.jpg" alt="google play store icon">
    </a>
    <a href="https://itunes.apple.com/in/app/growthfile/id1441388774?mt=8" target="_blank">
      <img src="img/app-store-icon.jpg" alt="apple app store icon">
    </a>
  </div>

  <script src="js/download.js"></script>
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
