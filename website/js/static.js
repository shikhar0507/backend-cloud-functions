

window.addEventListener('load',function(){
  
  window.mdc.autoInit();
  
  firebase.auth().onAuthStateChanged(function (user) {
    if(user) {
        return addLogoutBtn();
    }
    
  });
  const solutionsBtn = document.getElementById('solutions-button');
  const solutionsMenu = new mdc.menu.MDCMenu(document.getElementById('solutions-menu'));
  solutionsBtn.addEventListener('click', function () {
    solutionsMenu.open = true;
  })
  
  const drawer = new mdc.drawer.MDCDrawer(document.querySelector(".mdc-drawer"))

  const menu = new mdc.iconButton.MDCIconButtonToggle(document.getElementById('menu'))
  const topAppBar = new mdc.topAppBar.MDCTopAppBar(document.querySelector('.mdc-top-app-bar'))
  menu.listen('MDCIconButtonToggle:change', function (event) {
    drawer.open = !drawer.open;
  })
})


function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

function loginButton() {

  const a = createElement('a', {
    className: 'mdc-top-app-bar__action-item mdc-button',
    href: './signup.html',
    id: 'app-bar-login',
    textContent: 'Log in'
  })
  new mdc.ripple.MDCRipple(a)
  return a
}