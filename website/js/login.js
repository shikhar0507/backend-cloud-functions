var linearProgress;
var appKeys = new AppKeys();

const parseRedirect = (type) => {
    const param = new URLSearchParams(document.location.search.substring(1));
    return param.get(type);
}

const login = (el) => {
    if (!el) return;
    el.innerHTML = loginDom();
    linearProgress = new mdc.linearProgress.MDCLinearProgress(document.getElementById('card-progress'));
    // if (appKeys.getMode() === 'dev') {
    //     firebase.auth().settings.appVerificationDisabledForTesting = true
    // }
    const numberField = new mdc.textField.MDCTextField(document.getElementById('phone-number-field'));
    const iti = phoneFieldInit(numberField, document.getElementById('country-dom'));
    numberField.focus()
    numberField.foundation_.autoCompleteFocus();
    console.log(numberField);

    const verifyNumber = new mdc.ripple.MDCRipple(document.getElementById('verify-phone-number'))
    
    verifyNumber.root_.addEventListener('click', function () {
        
        var error = iti.getValidationError();
        if (error !== 0) {
            const message = getMessageStringErrorCode(error);
            setHelperInvalid(numberField, message);
            return
        }
        if (!iti.isValidNumber()) {
            setHelperInvalid(numberField, 'Invalid number. Please check again');
            return;
        }
        console.log(iti.getNumber(intlTelInputUtils.numberFormat.E164))

        numberField.value = iti.getNumber(intlTelInputUtils.numberFormat.E164);

        linearProgress.open();
        disabledLoginArea();

        numberField.helperTextContent = '';
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = handleRecaptcha('verify-phone-number');
        }

        window.recaptchaVerifier.render().then(function (widgetId) {
            window.recaptchaWidgetId = widgetId;
            return window.recaptchaVerifier.verify()
            .then(function () {
                return firebase.auth().signInWithPhoneNumber(numberField.value, window.recaptchaVerifier) 
            }).then(function (confirmResult) {
                enableLoginArea()
                return handleOtp(confirmResult,el);
            }).catch(function (error) {
                errorUI(error)
            })
        }).catch(console.error)
    
    })
}

const getMessageStringErrorCode = (code) => {
    let message = ''
    switch (code) {
        case 1:
            message = 'Please enter a correct country code';
            break;

        case 2:
            message = 'Number is too short';
            break;
        case 3:
            message = 'Number is too long';
            break;
        case 4:
            message = 'Invalid Number'
            break;

        default:
            message = ''
            break
    }
    return message;
}

const errorUI = (error) => {
    console.log(error);
    linearProgress.close();
    enableLoginArea();

}

const updateAuth = (el, auth) => {
    if (!el) return
    el.innerHTML = updateAuthDom(auth);
    linearProgress = new mdc.linearProgress.MDCLinearProgress(document.querySelector('.mdc-linear-progress'));
    let nameField;
    if (!auth.displayName) {
        nameField = new mdc.textField.MDCTextField(document.getElementById('name-field'))
    };

    const emailField = new mdc.textField.MDCTextField(document.getElementById('email-field'))
    let emailValue = ''
    if (auth.email) {
        emailValue = auth.email
    } 


    emailField.value = emailValue
    const updateBtn = new mdc.ripple.MDCRipple(document.getElementById('update-auth-btn'))
    if (auth.displayName && auth.email && !auth.emailVerified) {
        document.querySelector('.text-indicator p').textContent = 'Verify email address';
        updateBtn.root_.querySelector('span').textContent = 'SEND VERIFICATION LINK'
    }

    updateBtn.root_.addEventListener('click', function () {
        if (nameField && !nameField.value) {
            setHelperInvalid(nameField, 'Name cannot be empty');
            return;
        }
        if (!emailField.value) {
            setHelperInvalid(emailField, 'Email cannot be empty');
            return;
        }
        if (!isValidEmail(emailField.value)) {
            setHelperInvalid(emailField, 'Enter a correct email address');
            return;
        };

        linearProgress.open();
        disabledLoginArea();

        auth.updateProfile({
            displayName: nameField ? nameField.value.trim() : auth.displayName
        }).then(function () {

            if (auth.emailVerified && auth.email) {
                linearProgress.close();

                return window.location.reload();
            };

            const actionSettings = {
                url: `${window.location.origin}${window.location.pathname}?email=${emailField.value}`,
                handleCodeInApp: false,
            }

            if (!auth.email || emailField.value !== auth.email) {
                auth.updateEmail(emailField.value).then(function () {

                    return auth.sendEmailVerification(actionSettings)
                }).then(updateLoginCardForEmailVerificaion).catch(function (error) {
                    handleEmailError(error, emailField);
                })
                return;
            }
            if (!auth.emailVerified) {

                auth.sendEmailVerification(actionSettings).then(updateLoginCardForEmailVerificaion).catch(function (error) {

                    handleEmailError(error, emailField);
                })
                return;
            }
        })
    })
}

const updateLoginCardForEmailVerificaion = () => {
    linearProgress.close();
    window.location.reload();

}


const loginDom = () => {
    return `
    <div class='login-container mini'>
    <div class='login-box mdc-card mdc-card--outlined'>
        <div class='progress-container'>
            <div role="progressbar" class="mdc-linear-progress mdc-linear-progress--indeterminate mdc-linear-progress--closed" id='card-progress'>
                <div class="mdc-linear-progress__buffering-dots"></div>
                <div class="mdc-linear-progress__buffer"></div>
                <div class="mdc-linear-progress__bar mdc-linear-progress__primary-bar">
                <span class="mdc-linear-progress__bar-inner"></span>
                </div>
                <div class="mdc-linear-progress__bar mdc-linear-progress__secondary-bar">
                <span class="mdc-linear-progress__bar-inner"></span>
                </div>
            </div>
        </div>
        <div class='mdc-card__primary'>
            <div id='login-header'></div>
            <div class='meta'>
                <div class='logo'>
                    <img src='./img/icon.png' class='logo'>
                </div>
                <div class='text-indicator'>
                    <p class='mdc-typography--headline6 text-center'>Log into Growthfile</p>
                    
                </div>
            </div>

            <div class='login-area'>
            
            <div class='input-container'>
                <div class='phone-number-container'>
                    ${textFieldTelephone({id:'phone-number-field',autocomplete:'on'})}
                    <div class="mdc-text-field-helper-line">
                        <div class="mdc-text-field-helper-text mdc-text-field-helper-text--validation-msg"></div>
                    </div>
                    </div>
                    <div class='pt-10' id='recaptcha-container'></div>
                
            </div>
            <div class='legal-checkbox'>
                <div class="mdc-form-field">
                    <div class="mdc-checkbox">
                        <input type="checkbox"
                                class="mdc-checkbox__native-control"
                                id="login-legal-checkbox"/>
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
                        <label for="login-legal-checkbox">I agree to Growthfile <a href='./legal.html#privacy-policy' class='no-underline'>Privacy Policy</a> &
                            <a href='./legal.html#terms-of-use-administrator' class='no-underline'>Terms of use</a>
                        </label>
                    </div>
                </div>
                <div class='action-buttons'>
                    <button class='mdc-button mdc-button--raised full-width' id='verify-phone-number'>
                        <span class='mdc-button__label'>
                            Log in 
                        </span>
                    </button>
                </div>
                <div class='full-width text-center mt-20 account-create--section'>
                    <span>Don't have an account ? 
                        <a href='./signup' class='ml-10 sign-up-link'>FREE SIGN UP</a>
                    </span>
                </div>
            </div>
        
        </div>
        </div>
        <div id='country-dom'></div>
    </div>`
}

const updateAuthDom = (auth) => {
    return ` <div class='login-container'>
    <div class='login-box mdc-card'>
    <div class='progress-container'>
    <div role="progressbar" class="mdc-linear-progress mdc-linear-progress--indeterminate mdc-linear-progress--closed">
    <div class="mdc-linear-progress__buffering-dots"></div>
    <div class="mdc-linear-progress__buffer"></div>
    <div class="mdc-linear-progress__bar mdc-linear-progress__primary-bar">
      <span class="mdc-linear-progress__bar-inner"></span>
    </div>
    <div class="mdc-linear-progress__bar mdc-linear-progress__secondary-bar">
      <span class="mdc-linear-progress__bar-inner"></span>
    </div>
  </div>
    </div>
    
    <div class='mdc-card__primary'>
        <div class='logo'>
            <img src='${window.location.origin}/img/icon.png' class='logo'>

        </div>
        <div class='login-area'>
        
        <div class='text-indicator'>
            <p class='mdc-typography--headline6 text-center mb-0'>Complete your profile</p>
             <div class='pt-10 text-center'>
             </div>
             
        </div>
        <div class='input-container'>
        ${!auth.displayName ? `${textField({label:'Name',id:'name-field',type:'text',autocomplete:'off'})}
        <div class="mdc-text-field-helper-line">
             <div class="mdc-text-field-helper-text mdc-text-field-helper-text--validation-msg"></div>
        </div>`:''}
        
          
            <div class='pt-20'>
                ${textField({label:'Email',id:'email-field',type:'email',autocomplete:'off'})}
                <div class="mdc-text-field-helper-line">
                    <div class="mdc-text-field-helper-text mdc-text-field-helper-text--validation-msg"></div>
            </div>
                </div>
           
        </div>
        <div class='action-buttons'>
            <div class='actions'>
                <button class='mdc-button mdc-button--raised' id='update-auth-btn'>
                    <span class='mdc-button__label'>
                        UPDATE
                    </span>
                </button>
            </div>
        </div>
        </div>
      
    </div>
    </div>
    </div>`
}


// const isValidEmail = (emailString) => {
//     return /^([A-Za-z0-9_\-\.])+\@([A-Za-z0-9_\-\.])+\.([A-Za-z]{2,4})$/
//         .test(emailString);
// }





const disabledLoginArea = () => {
    document.querySelector('.login-area').classList.add('disabled')
}
const enableLoginArea = () => {
    document.querySelector('.login-area').classList.remove('disabled');

}
const handleOtp = (confirmResult,el) => {
    linearProgress.close();
    el.querySelector('.text-indicator p').textContent = 'OTP has been sent.'
    const backBtn = iconButtonWithLabel('arrow_back','Back');
    backBtn.addEventListener('click',function(){
       window.location.reload();
    })
    document.getElementById('login-header').appendChild(backBtn);
    el.querySelector('.input-container').innerHTML = `${textFieldFilled({id:'otp-number-field',value:'',type:'number',label:'ENTER OTP'})}
    <div class="mdc-text-field-helper-line">
        <div class="mdc-text-field-helper-text mdc-text-field-helper-text--validation-msg"></div>
    </div>
    `
    const otpField = new mdc.textField.MDCTextField(document.getElementById('otp-number-field'));
    const verifyOtpBtn = button('SUBMIT');
    verifyOtpBtn.classList.add('full-width','mdc-button--raised');
    verifyOtpBtn.addEventListener('click',function(){

            if (!otpField.value) {
                setHelperInvalid(otpField, 'Invalid OTP');
                return;
            }
            linearProgress.open();
            confirmResult.confirm(otpField.value).then(handleAuthAnalytics).catch(function (error) {
                console.log(error)
                linearProgress.close();
                if (error.code === 'auth/invalid-verification-code') {
                    setHelperInvalid(otpField, 'Wrong OTP');
                    return;
                }
            })
    })
    document.querySelector('.action-buttons').innerHTML = ''
    document.querySelector('.action-buttons').appendChild(verifyOtpBtn)
}

function isAdmin(idTokenResult) {
    if (!idTokenResult.claims.hasOwnProperty('admin')) return;
    if (!Array.isArray(idTokenResult.claims.admin)) return;
    if (!idTokenResult.claims.admin.length) return;
    return true;
}

const handleEmailError = (error, emailField) => {
    linearProgress.close();
    enableLoginArea()
    console.log(error);
    if (error.code === 'auth/requires-recent-login') {
        errorUI(error);
        linearProgress.open();
        setTimeout(signOut, 2000)
        return;
    };

    setHelperInvalid(emailField, getEmailErrorMessage(error));
    errorUI(error);
}

function getEmailErrorMessage(error) {
    if (error.code === 'auth/requires-recent-login') {
        return 'auth/requires-recent-login'
    };
    if (error.code === 'auth/email-already-in-use') {
       return 'Email address is already in use. Add a different email address'
       
    };
    if (error.code === 'auth/invalid-email') {
       return  'Enter a correct email address'
    }
   
}