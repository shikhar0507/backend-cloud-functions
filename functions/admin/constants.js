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


'use strict';


/** Types allowed for the field `type` in the attachment object. */
const validTypes = new Map()
  .set('boolean', 'boolean')
  .set('email', 'email')
  .set('number', 'number')
  .set('string', 'string')
  .set('weekday', 'weekday')
  .set('phoneNumber', 'phoneNumber')
  .set('HH:MM', 'HH:MM')
  .set('base64', 'base64');

/** Weekdays accepted in the attachment for the field `type` of `weekday`. */
const weekdays = new Map()
  .set('monday', 'monday')
  .set('tuesday', 'tuesday')
  .set('wednesday', 'wednesday')
  .set('thursday', 'thursday')
  .set('friday', 'friday')
  .set('saturday', 'saturday')
  .set('sunday', 'sunday');

/**
 * Statuses which are allowed for the `activity`, `subscription` or `office`.
 */
const activityStatuses = new Map()
  .set('PENDING', 'PENDING')
  .set('CONFIRMED', 'CONFIRMED')
  .set('CANCELLED', 'CANCELLED');

/**
 * Values of `canEdit` which for validating the `canEditRule`.
 */
const canEditRules = new Map()
  .set('ALL', 'ALL')
  .set('NONE', 'NONE')
  .set('ADMIN', 'ADMIN')
  .set('CREATOR', 'CREATOR')
  .set('EMPLOYEE', 'EMPLOYEE');

const templateFields = new Map()
  .set('name', 'name')
  .set('statusOnCreate', 'statusOnCreate')
  .set('canEditRule', 'canEditRule')
  .set('venue', 'venue')
  .set('schedule', 'schedule')
  .set('comment', 'comment')
  .set('attachment', 'attachment')
  .set('hidden', 'hidden');

/** Used while creating comments, to handle vowels correctly. */
const vowels = new Map()
  .set('a', 'a')
  .set('e', 'e')
  .set('i', 'i')
  .set('o', 'o')
  .set('u', 'u');

const createBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('template', 'template')
  .set('activityName', 'activityName')
  .set('share', 'share')
  .set('venue', 'venue')
  .set('schedule', 'schedule')
  .set('attachment', 'attachment');

const updateBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('schedule', 'schedule')
  .set('venue', 'venue');

const shareBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('share', 'share');

const changeStatusBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('status', 'status');

const commentBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('comment', 'comment');

const removeBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('remove', 'remove');

const phoneNumberUpdateBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('phoneNumber', 'phoneNumber');

const httpsActions = {
  checkIn: 'check-in',
  share: 'share',
  update: 'update',
  create: 'create',
  comment: 'comment',
  install: 'install',
  signup: 'signup',
  changeStatus: 'change-status',
  updatePhoneNumber: 'update-phone-number',
  videoPlay: 'video-play',
  productView: 'product-view',
  branchView: 'branch-view',
  webapp: 'webapp',
};

const reportingActions = {
  clientError: 'clientError',
  authDeleted: 'authDeleted',
  authChanged: 'authChanged',
  authDisabled: 'authDisabled',
  usedCustomClaims: 'usedCustomClaims',
};

const sendGridTemplateIds = {
  payroll: 'd-cf7785c6a4a04285b1b2cee7d0227052',
  footprints: 'd-90095557c1c54de1a153626bb0fbe03d',
  activityReports: 'd-2972abe4d32443fab45c75d901ffb02a',
  verificationEmail: 'd-7645b372912a490eb2062cf5cc076041',
  dailyStatusReport: 'd-a48d570e46914d0d8989f77a844a26e9',
  reimbursement: 'd-ae3a31066b0f447bbf8661570b4dc719',
  payrollMaster: 'd-4fa81720b3894e889522a3d48782e593',
};

const templatesWithNumber = new Set()
  .add('bill')
  .add('invoice')
  .add('sales order')
  .add('purchase order');

const templatesSet = new Set()
  .add('on duty')
  .add('admin')
  .add('branch')
  .add('check-in')
  .add('customer-type')
  .add('customer')
  .add('department')
  .add('dsr')
  .add('duty roster')
  .add('employee')
  .add('expense claim')
  .add('expense-type')
  .add('leave-type')
  .add('leave')
  .add('office')
  .add('product')
  .add('recipient')
  .add('subscription')
  .add('supplier-type')
  .add('supplier')
  .add('tour plan')
  .add('enquiry')
  .add('material')
  .add('bill')
  .add('invoice')
  .add('sales order')
  .add('purchase order')
  .add('payment')
  .add('collection');

/**
 *  Creating a Set and not using Moment's `moment.tz.names()`
  * because for iterating the array each time to find
  * if a timezone exists or not is `O(n^2)`.
  * Fetching the value from a Set is `O(1)`
  */
const timezonesSet = new Set()
  .add('Africa/Abidjan')
  .add('Africa/Accra')
  .add('Africa/Addis_Ababa')
  .add('Africa/Algiers')
  .add('Africa/Asmara')
  .add('Africa/Asmera')
  .add('Africa/Bamako')
  .add('Africa/Bangui')
  .add('Africa/Banjul')
  .add('Africa/Bissau')
  .add('Africa/Blantyre')
  .add('Africa/Brazzaville')
  .add('Africa/Bujumbura')
  .add('Africa/Cairo')
  .add('Africa/Casablanca')
  .add('Africa/Ceuta')
  .add('Africa/Conakry')
  .add('Africa/Dakar')
  .add('Africa/Dar_es_Salaam')
  .add('Africa/Djibouti')
  .add('Africa/Douala')
  .add('Africa/El_Aaiun')
  .add('Africa/Freetown')
  .add('Africa/Gaborone')
  .add('Africa/Harare')
  .add('Africa/Johannesburg')
  .add('Africa/Juba')
  .add('Africa/Kampala')
  .add('Africa/Khartoum')
  .add('Africa/Kigali')
  .add('Africa/Kinshasa')
  .add('Africa/Lagos')
  .add('Africa/Libreville')
  .add('Africa/Lome')
  .add('Africa/Luanda')
  .add('Africa/Lubumbashi')
  .add('Africa/Lusaka')
  .add('Africa/Malabo')
  .add('Africa/Maputo')
  .add('Africa/Maseru')
  .add('Africa/Mbabane')
  .add('Africa/Mogadishu')
  .add('Africa/Monrovia')
  .add('Africa/Nairobi')
  .add('Africa/Ndjamena')
  .add('Africa/Niamey')
  .add('Africa/Nouakchott')
  .add('Africa/Ouagadougou')
  .add('Africa/Porto-Novo')
  .add('Africa/Sao_Tome')
  .add('Africa/Timbuktu')
  .add('Africa/Tripoli')
  .add('Africa/Tunis')
  .add('Africa/Windhoek')
  .add('America/Adak')
  .add('America/Anchorage')
  .add('America/Anguilla')
  .add('America/Antigua')
  .add('America/Araguaina')
  .add('America/Argentina/Buenos_Aires')
  .add('America/Argentina/Catamarca')
  .add('America/Argentina/ComodRivadavia')
  .add('America/Argentina/Cordoba')
  .add('America/Argentina/Jujuy')
  .add('America/Argentina/La_Rioja')
  .add('America/Argentina/Mendoza')
  .add('America/Argentina/Rio_Gallegos')
  .add('America/Argentina/Salta')
  .add('America/Argentina/San_Juan')
  .add('America/Argentina/San_Luis')
  .add('America/Argentina/Tucuman')
  .add('America/Argentina/Ushuaia')
  .add('America/Aruba')
  .add('America/Asuncion')
  .add('America/Atikokan')
  .add('America/Atka')
  .add('America/Bahia')
  .add('America/Bahia_Banderas')
  .add('America/Barbados')
  .add('America/Belem')
  .add('America/Belize')
  .add('America/Blanc-Sablon')
  .add('America/Boa_Vista')
  .add('America/Bogota')
  .add('America/Boise')
  .add('America/Buenos_Aires')
  .add('America/Cambridge_Bay')
  .add('America/Campo_Grande')
  .add('America/Cancun')
  .add('America/Caracas')
  .add('America/Catamarca')
  .add('America/Cayenne')
  .add('America/Cayman')
  .add('America/Chicago')
  .add('America/Chihuahua')
  .add('America/Coral_Harbour')
  .add('America/Cordoba')
  .add('America/Costa_Rica')
  .add('America/Creston')
  .add('America/Cuiaba')
  .add('America/Curacao')
  .add('America/Danmarkshavn')
  .add('America/Dawson')
  .add('America/Dawson_Creek')
  .add('America/Denver')
  .add('America/Detroit')
  .add('America/Dominica')
  .add('America/Edmonton')
  .add('America/Eirunepe')
  .add('America/El_Salvador')
  .add('America/Ensenada')
  .add('America/Fort_Nelson')
  .add('America/Fort_Wayne')
  .add('America/Fortaleza')
  .add('America/Glace_Bay')
  .add('America/Godthab')
  .add('America/Goose_Bay')
  .add('America/Grand_Turk')
  .add('America/Grenada')
  .add('America/Guadeloupe')
  .add('America/Guatemala')
  .add('America/Guayaquil')
  .add('America/Guyana')
  .add('America/Halifax')
  .add('America/Havana')
  .add('America/Hermosillo')
  .add('America/Indiana/Indianapolis')
  .add('America/Indiana/Knox')
  .add('America/Indiana/Marengo')
  .add('America/Indiana/Petersburg')
  .add('America/Indiana/Tell_City')
  .add('America/Indiana/Vevay')
  .add('America/Indiana/Vincennes')
  .add('America/Indiana/Winamac')
  .add('America/Indianapolis')
  .add('America/Inuvik')
  .add('America/Iqaluit')
  .add('America/Jamaica')
  .add('America/Jujuy')
  .add('America/Juneau')
  .add('America/Kentucky/Louisville')
  .add('America/Kentucky/Monticello')
  .add('America/Knox_IN')
  .add('America/Kralendijk')
  .add('America/La_Paz')
  .add('America/Lima')
  .add('America/Los_Angeles')
  .add('America/Louisville')
  .add('America/Lower_Princes')
  .add('America/Maceio')
  .add('America/Managua')
  .add('America/Manaus')
  .add('America/Marigot')
  .add('America/Martinique')
  .add('America/Matamoros')
  .add('America/Mazatlan')
  .add('America/Mendoza')
  .add('America/Menominee')
  .add('America/Merida')
  .add('America/Metlakatla')
  .add('America/Mexico_City')
  .add('America/Miquelon')
  .add('America/Moncton')
  .add('America/Monterrey')
  .add('America/Montevideo')
  .add('America/Montreal')
  .add('America/Montserrat')
  .add('America/Nassau')
  .add('America/New_York')
  .add('America/Nipigon')
  .add('America/Nome')
  .add('America/Noronha')
  .add('America/North_Dakota/Beulah')
  .add('America/North_Dakota/Center')
  .add('America/North_Dakota/New_Salem')
  .add('America/Ojinaga')
  .add('America/Panama')
  .add('America/Pangnirtung')
  .add('America/Paramaribo')
  .add('America/Phoenix')
  .add('America/Port-au-Prince')
  .add('America/Port_of_Spain')
  .add('America/Porto_Acre')
  .add('America/Porto_Velho')
  .add('America/Puerto_Rico')
  .add('America/Punta_Arenas')
  .add('America/Rainy_River')
  .add('America/Rankin_Inlet')
  .add('America/Recife')
  .add('America/Regina')
  .add('America/Resolute')
  .add('America/Rio_Branco')
  .add('America/Rosario')
  .add('America/Santa_Isabel')
  .add('America/Santarem')
  .add('America/Santiago')
  .add('America/Santo_Domingo')
  .add('America/Sao_Paulo')
  .add('America/Scoresbysund')
  .add('America/Shiprock')
  .add('America/Sitka')
  .add('America/St_Barthelemy')
  .add('America/St_Johns')
  .add('America/St_Kitts')
  .add('America/St_Lucia')
  .add('America/St_Thomas')
  .add('America/St_Vincent')
  .add('America/Swift_Current')
  .add('America/Tegucigalpa')
  .add('America/Thule')
  .add('America/Thunder_Bay')
  .add('America/Tijuana')
  .add('America/Toronto')
  .add('America/Tortola')
  .add('America/Vancouver')
  .add('America/Virgin')
  .add('America/Whitehorse')
  .add('America/Winnipeg')
  .add('America/Yakutat')
  .add('America/Yellowknife')
  .add('Antarctica/Casey')
  .add('Antarctica/Davis')
  .add('Antarctica/DumontDUrville')
  .add('Antarctica/Macquarie')
  .add('Antarctica/Mawson')
  .add('Antarctica/McMurdo')
  .add('Antarctica/Palmer')
  .add('Antarctica/Rothera')
  .add('Antarctica/South_Pole')
  .add('Antarctica/Syowa')
  .add('Antarctica/Troll')
  .add('Antarctica/Vostok')
  .add('Arctic/Longyearbyen')
  .add('Asia/Aden')
  .add('Asia/Almaty')
  .add('Asia/Amman')
  .add('Asia/Anadyr')
  .add('Asia/Aqtau')
  .add('Asia/Aqtobe')
  .add('Asia/Ashgabat')
  .add('Asia/Ashkhabad')
  .add('Asia/Atyrau')
  .add('Asia/Baghdad')
  .add('Asia/Bahrain')
  .add('Asia/Baku')
  .add('Asia/Bangkok')
  .add('Asia/Barnaul')
  .add('Asia/Beirut')
  .add('Asia/Bishkek')
  .add('Asia/Brunei')
  .add('Asia/Calcutta')
  .add('Asia/Chita')
  .add('Asia/Choibalsan')
  .add('Asia/Chongqing')
  .add('Asia/Chungking')
  .add('Asia/Colombo')
  .add('Asia/Dacca')
  .add('Asia/Damascus')
  .add('Asia/Dhaka')
  .add('Asia/Dili')
  .add('Asia/Dubai')
  .add('Asia/Dushanbe')
  .add('Asia/Famagusta')
  .add('Asia/Gaza')
  .add('Asia/Harbin')
  .add('Asia/Hebron')
  .add('Asia/Ho_Chi_Minh')
  .add('Asia/Hong_Kong')
  .add('Asia/Hovd')
  .add('Asia/Irkutsk')
  .add('Asia/Istanbul')
  .add('Asia/Jakarta')
  .add('Asia/Jayapura')
  .add('Asia/Jerusalem')
  .add('Asia/Kabul')
  .add('Asia/Kamchatka')
  .add('Asia/Karachi')
  .add('Asia/Kashgar')
  .add('Asia/Kathmandu')
  .add('Asia/Katmandu')
  .add('Asia/Khandyga')
  .add('Asia/Kolkata')
  .add('Asia/Krasnoyarsk')
  .add('Asia/Kuala_Lumpur')
  .add('Asia/Kuching')
  .add('Asia/Kuwait')
  .add('Asia/Macao')
  .add('Asia/Macau')
  .add('Asia/Magadan')
  .add('Asia/Makassar')
  .add('Asia/Manila')
  .add('Asia/Muscat')
  .add('Asia/Nicosia')
  .add('Asia/Novokuznetsk')
  .add('Asia/Novosibirsk')
  .add('Asia/Omsk')
  .add('Asia/Oral')
  .add('Asia/Phnom_Penh')
  .add('Asia/Pontianak')
  .add('Asia/Pyongyang')
  .add('Asia/Qatar')
  .add('Asia/Qyzylorda')
  .add('Asia/Rangoon')
  .add('Asia/Riyadh')
  .add('Asia/Saigon')
  .add('Asia/Sakhalin')
  .add('Asia/Samarkand')
  .add('Asia/Seoul')
  .add('Asia/Shanghai')
  .add('Asia/Singapore')
  .add('Asia/Srednekolymsk')
  .add('Asia/Taipei')
  .add('Asia/Tashkent')
  .add('Asia/Tbilisi')
  .add('Asia/Tehran')
  .add('Asia/Tel_Aviv')
  .add('Asia/Thimbu')
  .add('Asia/Thimphu')
  .add('Asia/Tokyo')
  .add('Asia/Tomsk')
  .add('Asia/Ujung_Pandang')
  .add('Asia/Ulaanbaatar')
  .add('Asia/Ulan_Bator')
  .add('Asia/Urumqi')
  .add('Asia/Ust-Nera')
  .add('Asia/Vientiane')
  .add('Asia/Vladivostok')
  .add('Asia/Yakutsk')
  .add('Asia/Yangon')
  .add('Asia/Yekaterinburg')
  .add('Asia/Yerevan')
  .add('Atlantic/Azores')
  .add('Atlantic/Bermuda')
  .add('Atlantic/Canary')
  .add('Atlantic/Cape_Verde')
  .add('Atlantic/Faeroe')
  .add('Atlantic/Faroe')
  .add('Atlantic/Jan_Mayen')
  .add('Atlantic/Madeira')
  .add('Atlantic/Reykjavik')
  .add('Atlantic/South_Georgia')
  .add('Atlantic/St_Helena')
  .add('Atlantic/Stanley')
  .add('Australia/ACT')
  .add('Australia/Adelaide')
  .add('Australia/Brisbane')
  .add('Australia/Broken_Hill')
  .add('Australia/Canberra')
  .add('Australia/Currie')
  .add('Australia/Darwin')
  .add('Australia/Eucla')
  .add('Australia/Hobart')
  .add('Australia/LHI')
  .add('Australia/Lindeman')
  .add('Australia/Lord_Howe')
  .add('Australia/Melbourne')
  .add('Australia/NSW')
  .add('Australia/North')
  .add('Australia/Perth')
  .add('Australia/Queensland')
  .add('Australia/South')
  .add('Australia/Sydney')
  .add('Australia/Tasmania')
  .add('Australia/Victoria')
  .add('Australia/West')
  .add('Australia/Yancowinna')
  .add('Brazil/Acre')
  .add('Brazil/DeNoronha')
  .add('Brazil/East')
  .add('Brazil/West')
  .add('CET')
  .add('CST6CDT')
  .add('Canada/Atlantic')
  .add('Canada/Central')
  .add('Canada/Eastern')
  .add('Canada/Mountain')
  .add('Canada/Newfoundland')
  .add('Canada/Pacific')
  .add('Canada/Saskatchewan')
  .add('Canada/Yukon')
  .add('Chile/Continental')
  .add('Chile/EasterIsland')
  .add('Cuba')
  .add('EET')
  .add('EST')
  .add('EST5EDT')
  .add('Egypt')
  .add('Eire')
  .add('Etc/GMT')
  .add('Etc/GMT+0')
  .add('Etc/GMT+1')
  .add('Etc/GMT+10')
  .add('Etc/GMT+11')
  .add('Etc/GMT+12')
  .add('Etc/GMT+2')
  .add('Etc/GMT+3')
  .add('Etc/GMT+4')
  .add('Etc/GMT+5')
  .add('Etc/GMT+6')
  .add('Etc/GMT+7')
  .add('Etc/GMT+8')
  .add('Etc/GMT+9')
  .add('Etc/GMT-0')
  .add('Etc/GMT-1')
  .add('Etc/GMT-10')
  .add('Etc/GMT-11')
  .add('Etc/GMT-12')
  .add('Etc/GMT-13')
  .add('Etc/GMT-14')
  .add('Etc/GMT-2')
  .add('Etc/GMT-3')
  .add('Etc/GMT-4')
  .add('Etc/GMT-5')
  .add('Etc/GMT-6')
  .add('Etc/GMT-7')
  .add('Etc/GMT-8')
  .add('Etc/GMT-9')
  .add('Etc/GMT0')
  .add('Etc/Greenwich')
  .add('Etc/UCT')
  .add('Etc/UTC')
  .add('Etc/Universal')
  .add('Etc/Zulu')
  .add('Europe/Amsterdam')
  .add('Europe/Andorra')
  .add('Europe/Astrakhan')
  .add('Europe/Athens')
  .add('Europe/Belfast')
  .add('Europe/Belgrade')
  .add('Europe/Berlin')
  .add('Europe/Bratislava')
  .add('Europe/Brussels')
  .add('Europe/Bucharest')
  .add('Europe/Budapest')
  .add('Europe/Busingen')
  .add('Europe/Chisinau')
  .add('Europe/Copenhagen')
  .add('Europe/Dublin')
  .add('Europe/Gibraltar')
  .add('Europe/Guernsey')
  .add('Europe/Helsinki')
  .add('Europe/Isle_of_Man')
  .add('Europe/Istanbul')
  .add('Europe/Jersey')
  .add('Europe/Kaliningrad')
  .add('Europe/Kiev')
  .add('Europe/Kirov')
  .add('Europe/Lisbon')
  .add('Europe/Ljubljana')
  .add('Europe/London')
  .add('Europe/Luxembourg')
  .add('Europe/Madrid')
  .add('Europe/Malta')
  .add('Europe/Mariehamn')
  .add('Europe/Minsk')
  .add('Europe/Monaco')
  .add('Europe/Moscow')
  .add('Europe/Nicosia')
  .add('Europe/Oslo')
  .add('Europe/Paris')
  .add('Europe/Podgorica')
  .add('Europe/Prague')
  .add('Europe/Riga')
  .add('Europe/Rome')
  .add('Europe/Samara')
  .add('Europe/San_Marino')
  .add('Europe/Sarajevo')
  .add('Europe/Saratov')
  .add('Europe/Simferopol')
  .add('Europe/Skopje')
  .add('Europe/Sofia')
  .add('Europe/Stockholm')
  .add('Europe/Tallinn')
  .add('Europe/Tirane')
  .add('Europe/Tiraspol')
  .add('Europe/Ulyanovsk')
  .add('Europe/Uzhgorod')
  .add('Europe/Vaduz')
  .add('Europe/Vatican')
  .add('Europe/Vienna')
  .add('Europe/Vilnius')
  .add('Europe/Volgograd')
  .add('Europe/Warsaw')
  .add('Europe/Zagreb')
  .add('Europe/Zaporozhye')
  .add('Europe/Zurich')
  .add('GB')
  .add('GB-Eire')
  .add('GMT')
  .add('GMT+0')
  .add('GMT-0')
  .add('GMT0')
  .add('Greenwich')
  .add('HST')
  .add('Hongkong')
  .add('Iceland')
  .add('Indian/Antananarivo')
  .add('Indian/Chagos')
  .add('Indian/Christmas')
  .add('Indian/Cocos')
  .add('Indian/Comoro')
  .add('Indian/Kerguelen')
  .add('Indian/Mahe')
  .add('Indian/Maldives')
  .add('Indian/Mauritius')
  .add('Indian/Mayotte')
  .add('Indian/Reunion')
  .add('Iran')
  .add('Israel')
  .add('Jamaica')
  .add('Japan')
  .add('Kwajalein')
  .add('Libya')
  .add('MET')
  .add('MST')
  .add('MST7MDT')
  .add('Mexico/BajaNorte')
  .add('Mexico/BajaSur')
  .add('Mexico/General')
  .add('NZ')
  .add('NZ-CHAT')
  .add('Navajo')
  .add('PRC')
  .add('PST8PDT')
  .add('Pacific/Apia')
  .add('Pacific/Auckland')
  .add('Pacific/Bougainville')
  .add('Pacific/Chatham')
  .add('Pacific/Chuuk')
  .add('Pacific/Easter')
  .add('Pacific/Efate')
  .add('Pacific/Enderbury')
  .add('Pacific/Fakaofo')
  .add('Pacific/Fiji')
  .add('Pacific/Funafuti')
  .add('Pacific/Galapagos')
  .add('Pacific/Gambier')
  .add('Pacific/Guadalcanal')
  .add('Pacific/Guam')
  .add('Pacific/Honolulu')
  .add('Pacific/Johnston')
  .add('Pacific/Kiritimati')
  .add('Pacific/Kosrae')
  .add('Pacific/Kwajalein')
  .add('Pacific/Majuro')
  .add('Pacific/Marquesas')
  .add('Pacific/Midway')
  .add('Pacific/Nauru')
  .add('Pacific/Niue')
  .add('Pacific/Norfolk')
  .add('Pacific/Noumea')
  .add('Pacific/Pago_Pago')
  .add('Pacific/Palau')
  .add('Pacific/Pitcairn')
  .add('Pacific/Pohnpei')
  .add('Pacific/Ponape')
  .add('Pacific/Port_Moresby')
  .add('Pacific/Rarotonga')
  .add('Pacific/Saipan')
  .add('Pacific/Samoa')
  .add('Pacific/Tahiti')
  .add('Pacific/Tarawa')
  .add('Pacific/Tongatapu')
  .add('Pacific/Truk')
  .add('Pacific/Wake')
  .add('Pacific/Wallis')
  .add('Pacific/Yap')
  .add('Poland')
  .add('Portugal')
  .add('ROC')
  .add('ROK')
  .add('Singapore')
  .add('Turkey')
  .add('UCT')
  .add('US/Alaska')
  .add('US/Aleutian')
  .add('US/Arizona')
  .add('US/Central')
  .add('US/East-Indiana')
  .add('US/Eastern')
  .add('US/Hawaii')
  .add('US/Indiana-Starke')
  .add('US/Michigan')
  .add('US/Mountain')
  .add('US/Pacific')
  .add('US/Pacific-New')
  .add('US/Samoa')
  .add('UTC')
  .add('Universal')
  .add('W-SU')
  .add('WET')
  .add('Zulu');


const dateFormats = {
  TIME: 'LT',
  HH_MM: 'HH:mm',
  DATE: 'Do MMM YYYY',
  DATE_TIME: 'MMM D YYYY HH[:]mm A',
  MONTH_YEAR: 'MMMM YYYY',
  MONTH_DATE: 'MMM DD',
  EXCEL_INPUT: 'D MMMM gggg HH:mm',
};

const reportNames = {
  PAYROLL_MASTER: 'payroll master',
  REIMBURSEMENT: 'reimbursement',
  SCHEDULE: 'schedule',
  COUNTER: 'counter',
  CUSTOMER: 'customer',
  ACTIVIT_REPORT: 'activity report',
  ON_DUTY: 'on duty',
  ENQUIRY: 'enquiry',
  INSTALL: 'install',
  SIGNUP: 'signup',
  EXPENSE_CLAIM: 'expense claim',
  DUTY_ROSTER: 'duty roster',
  CHECK_IN: 'check-in',
  DSR: 'dsr',
  FOOTPRINTS: 'footprints',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  TOUR_PLAN: 'tour plan',
  DAILY_STATUS_REPORT: 'daily status report',
};

const customMessages = {
  LEAVE_CANCELLED: `LEAVE CANCELLED`,
  TOUR_PLAN_CANCELLED: `TOUR PLAN CANCELLED`,
  ON_DUTY_CANCELLED: `ON DUTY CANCELLED`,
};

const loggingTags = {
  AUTH_REJECTIONS: 'AUTH_REJECTIONS',
};


module.exports = {
  vowels,
  weekdays,
  validTypes,
  dateFormats,
  reportNames,
  timezonesSet,
  httpsActions,
  canEditRules,
  loggingTags,
  templatesSet,
  templateFields,
  customMessages,
  shareBodyFields,
  activityStatuses,
  reportingActions,
  createBodyFields,
  updateBodyFields,
  removeBodyFields,
  commentBodyFields,
  sendGridTemplateIds,
  templatesWithNumber,
  changeStatusBodyFields,
  phoneNumberUpdateBodyFields,
};
