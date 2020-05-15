function createElement(tagName, attrs) {
  const el = document.createElement(tagName)
  if (attrs) {
    Object.keys(attrs).forEach(function (attr) {
      el[attr] = attrs[attr]
    })
  }
  return el;
}

const phoneFieldInit = (numberField, dropEl) => {
  const input = numberField.input_;
  return intlTelInput(input, {
    initialCountry: "IN",
    formatOnDisplay: false,
    separateDialCode: true,
    dropdownContainer: dropEl
  });
};

function textField(attr) {
  return `<div class="mdc-text-field mdc-text-field--outlined ${attr.label ? '' :'mdc-text-field--no-label'} full-width ${attr.leadingIcon ? 'mdc-text-field--with-leading-icon' :''} ${attr.trailingIcon ? 'mdc-text-field--with-trailing-icon' :''} ${attr.disabled ? 'mdc-text-field--disabled' :''}" id='${attr.id}'>
  ${attr.leadingIcon ? `<i class="material-icons mdc-text-field__icon mdc-text-field__icon--leading" tabindex="0" role="button">${attr.leadingIcon}</i>`:''}
  ${attr.trailingIcon ? `<i class="material-icons mdc-text-field__icon mdc-text-field__icon--trailing" tabindex="0" role="button" >${attr.trailingIcon}</i>` :''}
  <input autocomplete=${attr.autocomplete ? attr.autocomplete : 'off'} type="${attr.type || 'text'}" class="mdc-text-field__input" value="${attr.value || ''}"  ${attr.required ? 'required':''}  ${attr.disabled ? 'disabled':''} ${attr.readonly ? 'readonly':''}>
  
  <div class="mdc-notched-outline">
    <div class="mdc-notched-outline__leading"></div>
    ${attr.label ? `<div class="mdc-notched-outline__notch">
    <label  class="mdc-floating-label">${attr.label}</label>
  </div>` :''}
    
    <div class="mdc-notched-outline__trailing"></div>
  </div>
</div>`
}


const textFieldTelephone = (attr) => {
  return `<div class="mdc-text-field mdc-text-field--outlined mdc-text-field--no-label pl-0 pr-0" id=${attr.id}>
    <input class="mdc-text-field__input" id="text-field-hero-input" type='tel' value="${attr.value || ''}" required autocomplete=${attr.autocomplete}>
    <div class="mdc-notched-outline">
      <div class="mdc-notched-outline__leading"></div>
      <div class="mdc-notched-outline__trailing"></div>
    </div>
  </div>`
}

const textFieldFilled = (attr) => {
  return `<div class="mdc-text-field mdc-text-field--filled" id=${attr.id}>
    <span class="mdc-text-field__ripple"></span>
    <input class="mdc-text-field__input" id="text-field-hero-input" value="${attr.value|| ''}" type=${attr.type} autocomplete>
    <label for="text-field-hero-input" class="mdc-floating-label">${attr.label}</label>
    <div class="mdc-line-ripple"></div>
  </div>`
}
const textFieldFilledLeadingIcon = (id = '', icon, label) => {
  return `<div class="mdc-text-field mdc-text-field--outlined mdc-text-field--with-leading-icon" id='${id}'>
  
  <i class="material-icons mdc-text-field__icon mdc-text-field__icon--leading">${icon}</i>
  <input class="mdc-text-field__input" id="text-field-hero-input">
  <div class="mdc-notched-outline">
    <div class="mdc-notched-outline__leading"></div>
    <div class="mdc-notched-outline__notch">
      <label for="text-field-hero-input" class="mdc-floating-label">${label}</label>
    </div>
    <div class="mdc-notched-outline__trailing"></div>
  </div>
  </div>`
}

const headerButton = (label, id = '') => {
  const button = createElement('button', {
    className: 'mdc-button mdc-top-app-bar__action-item',
    id: id
  })
  const span = createElement('span', {
    className: 'mdc-button__label',
    textContent: label
  })
  button.appendChild(span);
  return button;
}


const createHeader = (sectionStart, sectionEnd) => {
  const header = createElement('header', {
    className: 'mdc-top-app-bar'
  })
  header.innerHTML = `  <div class="mdc-top-app-bar__row">
  <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-start">
    ${sectionStart}
  </section>
  <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-end" role="toolbar">
    ${sectionEnd}
  </section>
</div>`

  return new mdc.topAppBar.MDCTopAppBar(header);

}

const checkbox = (labelText, id) => {

  const container = createElement('div', {
    className: 'mdc-checkbox'
  })
  const input = `<input type="checkbox"
  class="mdc-checkbox__native-control"
  id="${id}"/>
<div class="mdc-checkbox__background">
<svg class="mdc-checkbox__checkmark"
  viewBox="0 0 24 24">
<path class="mdc-checkbox__checkmark-path"
     fill="none"
     d="M1.73,12.91 8.1,19.28 22.79,4.59"/>
</svg>
<div class="mdc-checkbox__mixedmark"></div>
</div>`
  container.innerHTML = input;

  const checkBoxInit = new mdc.checkbox.MDCCheckbox(container);
  return checkBoxInit;
}

const radio = (label, id) => {
  const container = createElement('div', {
    className: 'mdc-radio',
  })
  container.dataset.id = label;
  const input = `<input class="mdc-radio__native-control" type="radio" id="${id}" name="radio-set" value="${label}">
  <div class="mdc-radio__background">
    <div class="mdc-radio__outer-circle"></div>
    <div class="mdc-radio__inner-circle"></div>
  </div>`
  container.innerHTML = input;
  return container;
  // return new mdc.radio.MDCRadio(container);
}


const searchBar = (id) => {
  const container = createElement('div', {
    className: 'search-bar'
  });
  container.innerHTML = textFieldFilledLeadingIcon(id, 'search', 'search');
  console.log(container)
 
  return container;
}

const tabBar = (tabs) => {

  const container = createElement('div', {
    className: 'mdc-tab-bar'
  })
  const scroller = createElement('div', {
    className: 'mdc-tab-scroller'
  })
  const area = createElement('div', {
    className: 'mdc-tab-scroller__scroll-area'
  })
  const content = createElement('div', {
    className: 'mdc-tab-scroller__scroll-content'
  })
  tabs.forEach((tab, index) => {
    const button = createElement('button', {
      className: 'mdc-tab',
      role: 'tab',
      'aria-selected': 'true',

    })
    const indicator = createElement('div', {
      className: 'mdc-tab-indicator'
    })
    const underline = createElement('div', {
      className: 'mdc-tab-indicator__content mdc-tab-indicator__content--underline'
    })

    indicator.appendChild(underline)
    const buttonContent = createElement('span', {
      className: 'mdc-tab__content'
    })
    const icon = createElement('span', {
      className: 'mdc-tab__icon material-icons',
      textContent: tab.icon
    })
    const text = createElement('div', {
      className: 'mdc-tab__text-label',
      textContent: tab.label
    })
    const ripple = createElement('div', {
      className: 'mdc-tab__ripple'
    })
    buttonContent.appendChild(icon)
    buttonContent.appendChild(text);
    button.appendChild(buttonContent);
    button.appendChild(indicator);
    button.appendChild(ripple);
    content.appendChild(button)
  })
  area.appendChild(content)
  scroller.appendChild(area);
  container.appendChild(scroller)
  return container;

}

const actionCard = (attr) => {
  const card = createElement("div", {
    className: 'mdc-card mdc-card--outlined',
    id: attr.id
  });
  const headerContainer = createElement("div", {
    className: 'demo-card__primary'
  })
  const cardHeading = createElement('div', {
    className: 'card-heading'
  })
  const cardHeadingTitle = createElement('span', {
    className: 'emo-card__title mdc-typography mdc-typography--headline6',
    textContent: attr.title
  })
  const cardHeadingAction = createElement('div', {
    className: 'heading-action-container'
  })
  cardHeadingAction.appendChild(cardButton('add-assignee-btn').add('add'));
  cardHeading.appendChild(cardHeadingTitle)
  headerContainer.appendChild(cardHeading);
  headerContainer.appendChild(cardHeadingAction);

  card.appendChild(headerContainer)

  const primaryAction = createElement('div', {
    className: 'demo-card__primary-action'
  })
  const listSection = createElement('div', {
    className: 'list-section'
  })
  primaryAction.appendChild(listSection)
  card.appendChild(primaryAction);

  return card;

}

const snackBar = (labelText, buttonText) => {

  const container = createElement('div', {
    className: 'mdc-snackbar'
  })
  const surface = createElement('div', {
    className: 'mdc-snackbar__surface'
  })
  const label = createElement('div', {
    className: 'mdc-snackbar__label',
    role: 'status',
    'aria-live': 'polite',
    textContent: labelText
  })
  surface.appendChild(label)
  if(buttonText) {
    const actions = createElement('div', {
      className: 'mdc-snackbar__actions'
    })
    const button = createElement('button', {
      type: 'button',
      className: 'mdc-button mdc-snackbar__action',
      textContent: buttonText
    })
    actions.appendChild(button)
    surface.appendChild(actions)
  }

  container.appendChild(surface)
  const el = document.getElementById("snackbar-container")
  el.innerHTML = '';
  el.appendChild(container)
  const sb = new mdc.snackbar.MDCSnackbar(container);
  return sb;

}

const simpleDialog = (title, content) => {

  const container = createElement('div', {
    className: 'mdc-dialog',
    role: 'alertdialog',
    'aria-modal': "true",
    'aria-labelledby': title,
    'aria-describedby': "my-dialog-content"
  });

  container.innerHTML = `<div class="mdc-dialog__container">
  <div class="mdc-dialog__surface">
    <h2 class="mdc-dialog__title" id="dialog-title">${title}</h2>
      <div class="mdc-dialog__content" id="dialog-content">
          ${typeof content === 'String' ? content : content.outerHTML}
      </div>
    </div>
  </div>
  <div class="mdc-dialog__scrim"></div>`
  const el = document.getElementById('dialog-container');
  el.innerHTML = '';
  el.appendChild(container);
  const dialog = new mdc.dialog.MDCDialog(container);
  return dialog;
}

const alertDialog = (title, content) => {


  const container = createElement('div', {
    className: 'mdc-dialog',
    role: 'alertdialog',
    'aria-modal': "true",
    'aria-labelledby': title,
    'aria-describedby': "my-dialog-content"
  });

  container.innerHTML = `<div class="mdc-dialog__container">
  <div class="mdc-dialog__surface">
    <h2 class="mdc-dialog__title" id="dialog-title">${title}</h2>
    <div class="mdc-dialog__content" id="dialog-content">
        ${content}
    </div>
    <footer class="mdc-dialog__actions">
    <button type="button" class="mdc-button mdc-dialog__button" data-mdc-dialog-action="no">
      <span class="mdc-button__label">CANCEL</span>
    </button>
    <button type="button" class="mdc-button mdc-dialog__button" data-mdc-dialog-action="yes">
      <span class="mdc-button__label">Okay</span>
    </button>
    </footer> 
  </div>
</div>
<div class="mdc-dialog__scrim"></div>`
  const el = document.getElementById('dialog-container');
  el.innerHTML = '';
  el.appendChild(container);
  const dialog = new mdc.dialog.MDCDialog(container);
  return dialog;

}


const actionList = (attr) => {

  const container = createElement('div', {
    className: 'actionable-list-container'
  });

  const flex = createElement('div', {
    className: 'flex-container'
  })

  const li = createElement('li', {
    className: 'mdc-list-item'
  });

  const textSpan = createElement('span', {
    className: 'mdc-list-item__text'
  });

  const primaryText = createElement('span', {
    className: 'mdc-list-item__primary-text',
    textContent: attr.primaryTextContent
  });

  const secondaryText = createElement('span', {
    className: 'mdc-list-item__secondary-text',
    textContent: attr.secondaryTextContent || ''
  });

  textSpan.appendChild(primaryText)
  textSpan.appendChild(secondaryText);

  li.appendChild(textSpan);
  new mdc.ripple.MDCRipple(li)

  flex.appendChild(li)

  if (attr.status && attr.canEdit) {
    flex.appendChild(createStatusIcon(attr.status))
  }
  container.appendChild(flex)
  return container;

}


const createStatusIcon = (status) => {
  let btn;
  if (status === 'CANCELLED') {
    btn = createElement('button', {
      className: 'mdc-icon-button material-icons status-button',
      textContent: 'check',
    })
    btn.dataset.status = 'CONFIRMED'
  }
  if (status === 'CONFIRMED') {
    btn = createElement('button', {
      className: 'mdc-icon-button material-icons mdc-theme--error status-button',
      textContent: 'delete',

    })
    btn.dataset.status = 'CANCELLED'
  }
  if (status === 'PENDING') {
    btn = createElement('button', {
      className: 'mdc-icon-button material-icons mdc-theme--success status-button',
      textContent: 'check',

    })
    btn.dataset.status = 'CONFIRMED'
  }
  return btn;
}

const voucherList = (voucher) => {
  return `<li class="mdc-list-item" role="checkbox" aria-checked="false" style='height: auto;
    padding-bottom: 10px;padding-left: 0px;
    padding-right: 0px;'>
    <span class="mdc-list-item__graphic">
      <div class="mdc-checkbox">
        <input type="checkbox"
                class="mdc-checkbox__native-control"
                id="demo-list-checkbox-item-1"  />
        <div class="mdc-checkbox__background">
          <svg class="mdc-checkbox__checkmark"
                viewBox="0 0 24 24">
            <path class="mdc-checkbox__checkmark-path"
                  fill="none"
                  d="M1.73,12.91 8.1,19.28 22.79,4.59"/>
          </svg>
          <div class="mdc-checkbox__mixedmark"></div>
        </div>
      </div>
    </span>

    <img class='mdc-list-item__graphic' src=${voucher.photoURL || './img/person.png' }>
    <span class="mdc-list-item__text">
        <span class="mdc-list-item__primary-text">${voucher.displayName || voucher.phoneNumber || ''}</span>
        <span class="mdc-list-item__secondary-text mdc-typography--caption">${voucher.type}</span>
        ${voucher.cycleStart && voucher.cycleEnd ? `<p class='mt-0 mb-0 mdc-typography--caption'>${voucher.cycleStart} - ${voucher.cycleEnd}</p>` :''}
    </span>
    <span class='mdc-list-item__meta'>
        <span class='mdc-theme--primary mdc-typography--headline6 linked-li-amount'>${convertNumberToINR(voucher.amount)}</span>
       
    </span>
  </li>`


}



function showDate(timestamp) {
  const date = new Date(timestamp);
  return `${date.getDate()}/${date.getMonth() +1}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes()}`
}

function recipientCard(recipient) {
  return `
  <div class='mdc-card  mdc-card--outlined assignee-card' id='recipient-update-card'>
 <div class="demo-card__primary">
     <div class="card-heading">
         <span class="demo-card__title mdc-typography mdc-typography--headline6"> Manage Recipients</span>
      
      </div>
      <div class='recipients-container'>
        ${cardButton('add-assignee-btn').add('add').outerHTML}
      </div>
 </div>
 <div class="demo-card__primary-action">   
      <ul class='mdc-list demo-list mdc-list--two-line mdc-list--avatar-list'>
        ${recipient.include.map(function(assignee){
          return `${assigneeLi(assignee).outerHTML}`
        }).join("")}
      </li>
  </div>
     <div class="mdc-card__actions hidden">
         <div class="mdc-card__action-icons">
         </div>
         <div class="mdc-card__action-buttons">
         </div>
       </div>
</div>
</div>
`
}

const depositCard = (deposit) => {
  const exceptionKeys = {
    id: true,
    event: true,
    signature: true,
    officeId: true,
    paymentTime: true,
    amount: true
  }
  return `<div class='mdc-card mdc-card--outlined deposit-card expense-card mdc-layout-grid__cell'>
  <div class='inline-flex'>
      <p class='mdc-theme--primary'>${deposit.event}</p>
      <i class='material-icons'>keyboard_arrow_down</i>
  </div>
    <p class='mt-0'>Amount : ${convertNumberToINR(deposit.amount)}</p>
    <p class='mt-0'>Bank Account : ${deposit.bankAccount}</p>
    <p class='mt-0'>IFSC : ${deposit.ifsc}</p>
    ${deposit.paymentTime ? `<p class='mt-0'>Payment time : ${moment().calendar(deposit.paymentTime)}</p>` :''}
    <div class='meta-details hidden'>
        ${Object.keys(deposit).map(function(key){
          return  `${exceptionKeys[key] ? '' : `<p class='mt-0'>${key} : ${deposit[key]}</p>`}`
        }).join("")}
    </div>
  
  </div>`
}


const button = (label, id = '') => {
  const button = createElement('button', {
    className: 'mdc-button',
    id: id
  })
  const ripple = createElement('div',{
    className:'mdc-button__ripple'
  })
  const span = createElement('span', {
    className: 'mdc-button__label',
    textContent: label
  })
  button.appendChild(ripple)
  button.appendChild(span)
  new mdc.ripple.MDCRipple(button);
  return button;
}

const primaryButton = (label, id) => {
  const buttonEl = button(label, id)
  buttonEl.classList.add('mdc-button--raised');
  return buttonEl;
}


const uploadButton = (label, id) => {

  const btn = button(label, id);

  const input = createElement('input', {
    type: 'file',
    accept: ".csv,.xlsx,.xls",
    'data-maxsize': "2M",
    className: 'overlay-text',
  })
  btn.appendChild(input)
  return btn;
}

const iconButton = (icon, id) => {
  const button = createElement('button', {
    className: 'mdc-icon-button material-icons',
    textContent: icon,
    id: id
  })
  // new mdc.ripple.MDCRipple(button);
  return button;
}

const iconButtonWithLabel = (icon, label, id) => {
  const button = createElement('button', {
    className: 'mdc-button mdc-button--icon',
    id: id
  })
  const iconEl = createElement('i', {
    className: 'material-icons',
    textContent: icon
  })
  const span = createElement('span', {
    className: 'mdc-button-label',
    textContent: label
  })
  button.appendChild(iconEl)
  button.appendChild(span);
  new mdc.ripple.MDCRipple(button);
  return button;
}



const handleDragOver = (evt) => {
  evt.stopPropagation();
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'copy';
}


var xStart = null;
var yStart = null;
var sliderElement;
var sliderCallback = null;

function swipe(el, callback) {
  if (!el) return;
  sliderElement = el;
  sliderCallback = callback;
  el.addEventListener('touchstart', handleTouchStart, false);
  el.addEventListener('touchmove', handleTouchMove, false);
}

function removeSwipe() {
  if (!sliderElement) return;
  sliderElement.removeEventListener('touchstart', handleTouchStart, false);
  sliderElement.removeEventListener('touchmove', handleTouchMove, false);
  sliderElement = null;
  sliderCallback = null;
}

function handleTouchStart(evt) {

  const firstTouch = evt.touches[0];
  xStart = firstTouch.clientX
  yStart = firstTouch.clientY
}

function handleTouchMove(evt) {
  if (!xStart) return

  const xEnd = evt.touches[0].clientX;
  const yEnd = evt.touches[0].clientY;

  const xAxisDiff = xEnd - xStart;
  const yAxisDiff = yEnd - yStart;

  const listenerDetail = {
    direction: '',
    element: sliderElement
  }


  if (Math.abs(xAxisDiff) > Math.abs(yAxisDiff)) {
    if (xAxisDiff > 0) {

      listenerDetail.direction = 'left'
      // left
    } else {

      listenerDetail.direction = 'right'
      //right
    }
  } else {
    if (yAxisDiff > 0) {

      listenerDetail.direction = 'down'
    } else {

      listenerDetail.direction = 'up'
    }
  }
  xStart = null;
  yStart = null;
  sliderCallback(listenerDetail);

}




function Dialog(title, content, id) {
  this.title = title;
  this.content = content;
  this.id = id;

}



Dialog.prototype.create = function (type) {
  const parent = createElement('div', {
    className: 'mdc-dialog',
    role: 'alertDialog',
    id: this.id
  })
  parent.setAttribute('aria-modal', 'true')
  parent.setAttribute('aria-labelledby', 'Title')
  parent.setAttribute('aria-describedby', 'content')
  const container = createElement('div', {
    className: 'mdc-dialog__container'
  })
  const surface = createElement('div', {
    className: 'mdc-dialog__surface'
  })
  const h2 = createElement('h2', {
    className: 'mdc-dialog__title',
  })
  h2.innerHTML = this.title
  this.footer = createElement('footer', {
    className: 'mdc-dialog__actions'
  })
  const contentContainer = createElement('div', {
    className: 'mdc-dialog__content'
  });

  if (this.content instanceof HTMLElement) {
    contentContainer.appendChild(this.content)
  } else {
    contentContainer.innerHTML = this.content
  }


  surface.appendChild(h2)
  surface.appendChild(contentContainer);
  if (type !== 'simple') {

    this.cancelButton = createElement('button', {
      className: 'mdc-button mdc-dialog__button',
      type: 'button',
      textContent: 'Close'
    })
    this.cancelButton.setAttribute('data-mdc-dialog-action', 'close');
    this.cancelButton.style.marginRight = 'auto';

    this.okButton = createElement('button', {
      className: 'mdc-button mdc-dialog__button',
      type: 'button',
      textContent: 'Okay'
    });


    this.okButton.setAttribute('data-mdc-dialog-action', 'accept')
    this.footer.appendChild(this.cancelButton)
    this.footer.appendChild(this.okButton);
    surface.appendChild(this.footer)
  }

  container.appendChild(surface)
  parent.appendChild(container);
  parent.appendChild(createElement('div', {
    className: 'mdc-dialog__scrim'
  }))

  const dialogParent = document.getElementById('dialog-container')
  dialogParent.innerHTML = ''
  dialogParent.appendChild(parent)
  return new mdc.dialog.MDCDialog(parent);
}

function dialogButton(name, action) {
  const button = createElement('button', {
    className: 'mdc-button mdc-dialog__button',
    type: 'button',
    textContent: name
  });


  button.setAttribute('data-mdc-dialog-action', action)
  return button;
}


function createExtendedFab(icon, name, id, absolute) {
  const button = createElement('button', {
    className: 'mdc-fab mdc-fab--extended mdc-button--raised mdc-fab-custom',
    id: id
  })
  if (absolute) {
    button.classList.add('app-fab--absolute')
  }
  button.innerHTML = `
                 <span class="material-icons mdc-fab__icon">${icon}</span>
                 <span class="mdc-fab__label">${name}</span>
                 <div class="mdc-fab__ripple"></div>
                 `
  new mdc.ripple.MDCRipple(button);
  return button
}

function createCheckBoxList(attr) {
  return `<li class='mdc-list-item checkbox-list' tabindex="-1">
  <span class='mdc-list-item__text'>
      <span class='mdc-list-item__primary-text'>${attr.primaryText.trim()}</span>
      <span class='mdc-list-item__secondary-text mdc-theme--primary'>${attr.secondaryText.trim()}</span>
  </span>
  <span class="mdc-list-item__graphic mdc-list-item__meta">
  <div class="mdc-checkbox">
      <input type="checkbox"
              class="mdc-checkbox__native-control"
              id="demo-list-checkbox-item-${attr.index}" />
      <div class="mdc-checkbox__background">
        <svg class="mdc-checkbox__checkmark"
              viewBox="0 0 24 24">
          <path class="mdc-checkbox__checkmark-path"
                fill="none"
                d="M1.73,12.91 8.1,19.28 22.79,4.59"/>
        </svg>
        <div class="mdc-checkbox__mixedmark"></div>
      </div>
    </div>
</span>
</li>`
}



function createCheckBox(id, label = '') {
  return `
  <div class="mdc-form-field">
<div class="mdc-checkbox">
  <input type="checkbox"
         class="mdc-checkbox__native-control"
         id=${id}/>
  <div class="mdc-checkbox__background">
    <svg class="mdc-checkbox__checkmark"
         viewBox="0 0 24 24">
      <path class="mdc-checkbox__checkmark-path"
            fill="none"
            d="M1.73,12.91 8.1,19.28 22.79,4.59"/>
    </svg>
    <div class="mdc-checkbox__mixedmark"></div>
  </div>
  <div class="mdc-checkbox__ripple"></div>
</div>
<label for="${id}">${label}</label>
</div>`
}




function textFieldRemovable(type, label, placeholder) {
  const cont = createElement('div', {
    className: 'inline-flex mt-10'
  })
  let field;
  if (type === 'tel') {
    field = textFieldTelephoneWithHelper({
      placeholder: placeholder,
      customClass: 'contact-field'
    })
  } else {
    field = textField({
      label: label,
      type: type
    })
  }
  cont.appendChild(field)
  const button = createElement('button', {
    className: 'mdc-icon-button material-icons mdc-theme--error',
    textContent: 'remove'
  })
  new mdc.ripple.MDCRipple(button);
  cont.appendChild(button);
  return cont
}


function textFieldTelephoneWithHelper(attr) {
  const cont = createElement('div', {
    className: 'text-field-container'
  })
  if (attr.classList) {
    attr.classList.forEach(function (name) {
      cont.classList.add(name)
    });
  }
  cont.innerHTML = `
  ${textFieldTelephone(attr)}
  <div class="mdc-text-field-helper-line">
    <div class="mdc-text-field-helper-text mdc-text-field-helper-text--validation-msg"></div>
  </div>
`
  return cont
}


function isPhoneNumberValid(iti) {
  var errorCode = iti.getValidationError();

  const result = {
    message: '',
    valid: false
  }
  if (errorCode) {
    result.message = getPhoneFieldErrorMessage(errorCode);
    return result
  }
  if (!iti.isValidNumber()) {
    result.message = 'Invalid number';
    return result
  }
  result.valid = true;
  return result;
}


const clearBreadCrumbs = () => {
  const ul = document.getElementById('breadcrumb-ul');
  ul.innerHTML = '';
}
const addBreadCrumb = (breadcrumb) => {
  const ul = document.getElementById('breadcrumb-ul');
  ul.appendChild(breadcrumb);
}

const createBreadCrumb = (name) => {
  const frag = document.createDocumentFragment();

  const li = createElement('li', {
    className: 'breadcrumb-li',
    textContent: name
  });
  const div = createElement('div')
  div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/><path fill="none" d="M0 0h24v24H0V0z"/></svg>'
  frag.appendChild(li);
  frag.appendChild(div)
  return frag
}

const updateBreadCrumb = (name) => {
  const ul = document.getElementById('breadcrumb-ul');
  [...ul.querySelectorAll('li')].forEach((el) => {
    el.removeEventListener('click', back);
    el.addEventListener('click', back);
  })

  ul.appendChild(createBreadCrumb(name));
}


const downloadSampleBtn = (templateName) => {
  const btn = iconButtonWithLabel('arrow_downward', 'Download sample', 'download-sample')
  btn.dataset.downloadName = templateName;
  new mdc.ripple.MDCRipple(btn)
  return btn;
}



const createChip = (name) => {
  let chip = createElement("div", {
    className: 'mdc-chip'
  })
  chip.setAttribute("role", 'row');

  chip.innerHTML = `
  <div class="mdc-chip__ripple"></div>
  <span role="gridcell">
    <span role="button" tabindex="0" class="mdc-chip__text">${name}</span>
  </span>`

  return chip;
}


const filterChip = (name, leadingVisual, isImage) => {
  const chip = createElement('div', {
    className: 'mdc-chip'
  })
  chip.setAttribute('role', 'row');

  chip.innerHTML = `<div class="mdc-chip__ripple"></div>

  ${isImage ? `<img src="${leadingVisual}" class='mdc-chip__icon mdc-chip__icon--leading'> `: `<i class="material-icons mdc-chip__icon mdc-chip__icon--leading">${leadingVisual}</i>`}
  <span class="mdc-chip__checkmark" >
      <svg class="mdc-chip__checkmark-svg" viewBox="-2 -3 30 30">
        <path class="mdc-chip__checkmark-path" fill="none" stroke="black"
              d="M1.73,12.91 8.1,19.28 22.79,4.59"/>
      </svg>
    </span>
  <span role="gridcell">
    <span role="button" tabindex="0" class="mdc-chip__text">${name}</span>
  </span>`
  return chip;
}

const inputChip = (name) => {
  const chip = createElement('div', {
    className: 'mdc-chip'
  })
  chip.setAttribute('role', 'row')
  chip.innerHTML = ` <div class="mdc-chip__ripple"></div>
 <span role="gridcell">
   <span role="button" tabindex="0" class="mdc-chip__text">${name}</span>
 </span>
 <span role="gridcell">
   <i class="material-icons mdc-chip__icon mdc-chip__icon--trailing" tabindex="-1" role="button">cancel</i>
 </span>`

  return chip
}

const userChip = (name, leadingVisual, isImage) => {
  const chip = createElement('div', {
    className: 'mdc-chip'
  })
  chip.setAttribute('role', 'row');

  chip.innerHTML = `<div class="mdc-chip__ripple"></div>

  ${isImage ? `<img src="${leadingVisual}" class='mdc-chip__icon mdc-chip__icon--leading'> `: `<i class="material-icons mdc-chip__icon mdc-chip__icon--leading">${leadingVisual}</i>`}
  <span role="gridcell">
    <span role="button" tabindex="0" class="mdc-chip__text">${name}</span>
  </span>
  <span role="gridcell">
   <i class="material-icons mdc-chip__icon mdc-chip__icon--trailing" tabindex="-1" role="button">cancel</i>
 </span>`
  return chip;
}


const insertAfter = (newNode, referenceNode) => {
  referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}




const setHelperInvalid = (field, message) => {
  field.focus()
  field.foundation_.setValid(false)
  field.foundation_.adapter_.shakeLabel(true);
  field.helperTextContent = message;
}

function setHelperValid(field) {
  field.focus();
  field.foundation_.setValid(true);
  field.helperTextContent = '';
}

function actionButton(name, id = '') {
  const actionContainer = createElement('div', {
    className: 'action-button-container'
  })
  const submitContainer = createElement('div', {
    className: 'submit-button-cont'
  })
  const btn = button(name, id);
  btn.classList.add('mdc-button--raised', 'submit-btn');
  new mdc.ripple.MDCRipple(btn);
  submitContainer.appendChild(btn);
  actionContainer.appendChild(submitContainer);
  return actionContainer;

}

