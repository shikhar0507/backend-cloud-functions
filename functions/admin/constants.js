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
/** request method for growthfile ms project */
const msRequestTypes = {
  ACTIVITY: 'PUT',
  TIMER: 'GET',
};

/** Api Endpoints for growthfileMS */
const msEndpoints = {
  ACTIVITY: 'activity',
  TIMER: 'timer',
};

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
  WEEKDAY: 'dddd',
};

const reportNames = {
  CASHFREE: 'cashfree',
  PAYROLL_MASTER: 'payroll master',
  REIMBURSEMENT: 'reimbursement',
  COUNTER: 'counter',
  CUSTOMER: 'customer',
  ACTIVIT_REPORT: 'activity report',
  ENQUIRY: 'enquiry',
  INSTALL: 'install',
  SIGNUP: 'signup',
  CHECK_IN: 'check-in',
  FOOTPRINTS: 'footprints',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  DAILY_STATUS_REPORT: 'daily status report',
};

const loggingTags = {
  AUTH_REJECTIONS: 'AUTH_REJECTIONS',
};

const subcollectionNames = {
  ACTIVITIES: 'Activities',
  ATTENDANCES: 'Attendances',
  ADDENDUM: 'Addendum',
  SUBSCRIPTIONS: 'Subscriptions',
  WEBAPP: 'Webapp',
  ASSIGNEES: 'Assignees',
  TRANSACTIONS: 'Transactions',
  REIMBURSEMENTS: 'Reimbursements',
  VOUCHERS: 'Vouchers',
};

const allMonths = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const addendumTypes = {
  PRODUCT: 'product',
  ACTIVITY: 'activity',
  REIMBURSEMENT: 'reimbursement',
  ATTENDANCE: 'attendance',
  PAYMENT: 'payment',
  COMMENT: 'comment',
  SUBSCRIPTION: 'subscription',
  LOCATION: 'location',
};

/**
 * @see https: //www.currency-iso.org/dam/downloads/lists/list_one.xml
 */
const currencies = {
  '@Pblshd': '2018-08-29',
  CcyTbl: [
    {
      CtryNm: 'AFGHANISTAN',
      CcyNm: 'Afghani',
      Ccy: 'AFN',
      CcyNbr: '971',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ÅLAND ISLANDS',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ALBANIA',
      CcyNm: 'Lek',
      Ccy: 'ALL',
      CcyNbr: '008',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ALGERIA',
      CcyNm: 'Algerian Dinar',
      Ccy: 'DZD',
      CcyNbr: '012',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'AMERICAN SAMOA',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ANDORRA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ANGOLA',
      CcyNm: 'Kwanza',
      Ccy: 'AOA',
      CcyNbr: '973',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ANGUILLA',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ANTARCTICA',
      CcyNm: 'No universal currency',
    },
    {
      CtryNm: 'ANTIGUA AND BARBUDA',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ARGENTINA',
      CcyNm: 'Argentine Peso',
      Ccy: 'ARS',
      CcyNbr: '032',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ARMENIA',
      CcyNm: 'Armenian Dram',
      Ccy: 'AMD',
      CcyNbr: '051',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ARUBA',
      CcyNm: 'Aruban Florin',
      Ccy: 'AWG',
      CcyNbr: '533',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'AUSTRALIA',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'AUSTRIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'AZERBAIJAN',
      CcyNm: 'Azerbaijan Manat',
      Ccy: 'AZN',
      CcyNbr: '944',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BAHAMAS (THE)',
      CcyNm: 'Bahamian Dollar',
      Ccy: 'BSD',
      CcyNbr: '044',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BAHRAIN',
      CcyNm: 'Bahraini Dinar',
      Ccy: 'BHD',
      CcyNbr: '048',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'BANGLADESH',
      CcyNm: 'Taka',
      Ccy: 'BDT',
      CcyNbr: '050',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BARBADOS',
      CcyNm: 'Barbados Dollar',
      Ccy: 'BBD',
      CcyNbr: '052',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BELARUS',
      CcyNm: 'Belarusian Ruble',
      Ccy: 'BYN',
      CcyNbr: '933',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BELGIUM',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BELIZE',
      CcyNm: 'Belize Dollar',
      Ccy: 'BZD',
      CcyNbr: '084',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BENIN',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'BERMUDA',
      CcyNm: 'Bermudian Dollar',
      Ccy: 'BMD',
      CcyNbr: '060',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BHUTAN',
      CcyNm: 'Indian Rupee',
      Ccy: 'INR',
      CcyNbr: '356',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BHUTAN',
      CcyNm: 'Ngultrum',
      Ccy: 'BTN',
      CcyNbr: '064',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BOLIVIA (PLURINATIONAL STATE OF)',
      CcyNm: 'Boliviano',
      Ccy: 'BOB',
      CcyNbr: '068',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BOLIVIA (PLURINATIONAL STATE OF)',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'Mvdol',
      },
      Ccy: 'BOV',
      CcyNbr: '984',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BONAIRE, SINT EUSTATIUS AND SABA',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BOSNIA AND HERZEGOVINA',
      CcyNm: 'Convertible Mark',
      Ccy: 'BAM',
      CcyNbr: '977',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BOTSWANA',
      CcyNm: 'Pula',
      Ccy: 'BWP',
      CcyNbr: '072',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BOUVET ISLAND',
      CcyNm: 'Norwegian Krone',
      Ccy: 'NOK',
      CcyNbr: '578',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BRAZIL',
      CcyNm: 'Brazilian Real',
      Ccy: 'BRL',
      CcyNbr: '986',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BRITISH INDIAN OCEAN TERRITORY (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BRUNEI DARUSSALAM',
      CcyNm: 'Brunei Dollar',
      Ccy: 'BND',
      CcyNbr: '096',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BULGARIA',
      CcyNm: 'Bulgarian Lev',
      Ccy: 'BGN',
      CcyNbr: '975',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'BURKINA FASO',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'BURUNDI',
      CcyNm: 'Burundi Franc',
      Ccy: 'BIF',
      CcyNbr: '108',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CABO VERDE',
      CcyNm: 'Cabo Verde Escudo',
      Ccy: 'CVE',
      CcyNbr: '132',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CAMBODIA',
      CcyNm: 'Riel',
      Ccy: 'KHR',
      CcyNbr: '116',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CAMEROON',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CANADA',
      CcyNm: 'Canadian Dollar',
      Ccy: 'CAD',
      CcyNbr: '124',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CAYMAN ISLANDS (THE)',
      CcyNm: 'Cayman Islands Dollar',
      Ccy: 'KYD',
      CcyNbr: '136',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CENTRAL AFRICAN REPUBLIC (THE)',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CHAD',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CHILE',
      CcyNm: 'Chilean Peso',
      Ccy: 'CLP',
      CcyNbr: '152',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CHILE',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'Unidad de Fomento',
      },
      Ccy: 'CLF',
      CcyNbr: '990',
      CcyMnrUnts: '4',
    },
    {
      CtryNm: 'CHINA',
      CcyNm: 'Yuan Renminbi',
      Ccy: 'CNY',
      CcyNbr: '156',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CHRISTMAS ISLAND',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'COCOS (KEELING) ISLANDS (THE)',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'COLOMBIA',
      CcyNm: 'Colombian Peso',
      Ccy: 'COP',
      CcyNbr: '170',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'COLOMBIA',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'Unidad de Valor Real',
      },
      Ccy: 'COU',
      CcyNbr: '970',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'COMOROS (THE)',
      CcyNm: 'Comorian Franc',
      Ccy: 'KMF',
      CcyNbr: '174',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CONGO (THE DEMOCRATIC REPUBLIC OF THE)',
      CcyNm: 'Congolese Franc',
      Ccy: 'CDF',
      CcyNbr: '976',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CONGO (THE)',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'COOK ISLANDS (THE)',
      CcyNm: 'New Zealand Dollar',
      Ccy: 'NZD',
      CcyNbr: '554',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'COSTA RICA',
      CcyNm: 'Costa Rican Colon',
      Ccy: 'CRC',
      CcyNbr: '188',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: "CÔTE D'IVOIRE",
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'CROATIA',
      CcyNm: 'Kuna',
      Ccy: 'HRK',
      CcyNbr: '191',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CUBA',
      CcyNm: 'Cuban Peso',
      Ccy: 'CUP',
      CcyNbr: '192',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CUBA',
      CcyNm: 'Peso Convertible',
      Ccy: 'CUC',
      CcyNbr: '931',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CURAÇAO',
      CcyNm: 'Netherlands Antillean Guilder',
      Ccy: 'ANG',
      CcyNbr: '532',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CYPRUS',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'CZECHIA',
      CcyNm: 'Czech Koruna',
      Ccy: 'CZK',
      CcyNbr: '203',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'DENMARK',
      CcyNm: 'Danish Krone',
      Ccy: 'DKK',
      CcyNbr: '208',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'DJIBOUTI',
      CcyNm: 'Djibouti Franc',
      Ccy: 'DJF',
      CcyNbr: '262',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'DOMINICA',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'DOMINICAN REPUBLIC (THE)',
      CcyNm: 'Dominican Peso',
      Ccy: 'DOP',
      CcyNbr: '214',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ECUADOR',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'EGYPT',
      CcyNm: 'Egyptian Pound',
      Ccy: 'EGP',
      CcyNbr: '818',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'EL SALVADOR',
      CcyNm: 'El Salvador Colon',
      Ccy: 'SVC',
      CcyNbr: '222',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'EL SALVADOR',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'EQUATORIAL GUINEA',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'ERITREA',
      CcyNm: 'Nakfa',
      Ccy: 'ERN',
      CcyNbr: '232',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ESTONIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ETHIOPIA',
      CcyNm: 'Ethiopian Birr',
      Ccy: 'ETB',
      CcyNbr: '230',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'EUROPEAN UNION',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FALKLAND ISLANDS (THE) [MALVINAS]',
      CcyNm: 'Falkland Islands Pound',
      Ccy: 'FKP',
      CcyNbr: '238',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FAROE ISLANDS (THE)',
      CcyNm: 'Danish Krone',
      Ccy: 'DKK',
      CcyNbr: '208',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FIJI',
      CcyNm: 'Fiji Dollar',
      Ccy: 'FJD',
      CcyNbr: '242',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FINLAND',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FRANCE',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FRENCH GUIANA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'FRENCH POLYNESIA',
      CcyNm: 'CFP Franc',
      Ccy: 'XPF',
      CcyNbr: '953',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'FRENCH SOUTHERN TERRITORIES (THE)',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GABON',
      CcyNm: 'CFA Franc BEAC',
      Ccy: 'XAF',
      CcyNbr: '950',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'GAMBIA (THE)',
      CcyNm: 'Dalasi',
      Ccy: 'GMD',
      CcyNbr: '270',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GEORGIA',
      CcyNm: 'Lari',
      Ccy: 'GEL',
      CcyNbr: '981',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GERMANY',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GHANA',
      CcyNm: 'Ghana Cedi',
      Ccy: 'GHS',
      CcyNbr: '936',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GIBRALTAR',
      CcyNm: 'Gibraltar Pound',
      Ccy: 'GIP',
      CcyNbr: '292',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GREECE',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GREENLAND',
      CcyNm: 'Danish Krone',
      Ccy: 'DKK',
      CcyNbr: '208',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GRENADA',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GUADELOUPE',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GUAM',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GUATEMALA',
      CcyNm: 'Quetzal',
      Ccy: 'GTQ',
      CcyNbr: '320',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GUERNSEY',
      CcyNm: 'Pound Sterling',
      Ccy: 'GBP',
      CcyNbr: '826',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'GUINEA',
      CcyNm: 'Guinean Franc',
      Ccy: 'GNF',
      CcyNbr: '324',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'GUINEA-BISSAU',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'GUYANA',
      CcyNm: 'Guyana Dollar',
      Ccy: 'GYD',
      CcyNbr: '328',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HAITI',
      CcyNm: 'Gourde',
      Ccy: 'HTG',
      CcyNbr: '332',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HAITI',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HEARD ISLAND AND McDONALD ISLANDS',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HOLY SEE (THE)',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HONDURAS',
      CcyNm: 'Lempira',
      Ccy: 'HNL',
      CcyNbr: '340',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HONG KONG',
      CcyNm: 'Hong Kong Dollar',
      Ccy: 'HKD',
      CcyNbr: '344',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'HUNGARY',
      CcyNm: 'Forint',
      Ccy: 'HUF',
      CcyNbr: '348',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ICELAND',
      CcyNm: 'Iceland Krona',
      Ccy: 'ISK',
      CcyNbr: '352',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'INDIA',
      CcyNm: 'Indian Rupee',
      Ccy: 'INR',
      CcyNbr: '356',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'INDONESIA',
      CcyNm: 'Rupiah',
      Ccy: 'IDR',
      CcyNbr: '360',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'INTERNATIONAL MONETARY FUND (IMF)',
      CcyNm: 'SDR (Special Drawing Right)',
      Ccy: 'XDR',
      CcyNbr: '960',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'IRAN (ISLAMIC REPUBLIC OF)',
      CcyNm: 'Iranian Rial',
      Ccy: 'IRR',
      CcyNbr: '364',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'IRAQ',
      CcyNm: 'Iraqi Dinar',
      Ccy: 'IQD',
      CcyNbr: '368',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'IRELAND',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ISLE OF MAN',
      CcyNm: 'Pound Sterling',
      Ccy: 'GBP',
      CcyNbr: '826',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ISRAEL',
      CcyNm: 'New Israeli Sheqel',
      Ccy: 'ILS',
      CcyNbr: '376',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ITALY',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'JAMAICA',
      CcyNm: 'Jamaican Dollar',
      Ccy: 'JMD',
      CcyNbr: '388',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'JAPAN',
      CcyNm: 'Yen',
      Ccy: 'JPY',
      CcyNbr: '392',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'JERSEY',
      CcyNm: 'Pound Sterling',
      Ccy: 'GBP',
      CcyNbr: '826',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'JORDAN',
      CcyNm: 'Jordanian Dinar',
      Ccy: 'JOD',
      CcyNbr: '400',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'KAZAKHSTAN',
      CcyNm: 'Tenge',
      Ccy: 'KZT',
      CcyNbr: '398',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'KENYA',
      CcyNm: 'Kenyan Shilling',
      Ccy: 'KES',
      CcyNbr: '404',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'KIRIBATI',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'KOREA (THE DEMOCRATIC PEOPLE’S REPUBLIC OF)',
      CcyNm: 'North Korean Won',
      Ccy: 'KPW',
      CcyNbr: '408',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'KOREA (THE REPUBLIC OF)',
      CcyNm: 'Won',
      Ccy: 'KRW',
      CcyNbr: '410',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'KUWAIT',
      CcyNm: 'Kuwaiti Dinar',
      Ccy: 'KWD',
      CcyNbr: '414',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'KYRGYZSTAN',
      CcyNm: 'Som',
      Ccy: 'KGS',
      CcyNbr: '417',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LAO PEOPLE’S DEMOCRATIC REPUBLIC (THE)',
      CcyNm: 'Lao Kip',
      Ccy: 'LAK',
      CcyNbr: '418',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LATVIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LEBANON',
      CcyNm: 'Lebanese Pound',
      Ccy: 'LBP',
      CcyNbr: '422',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LESOTHO',
      CcyNm: 'Loti',
      Ccy: 'LSL',
      CcyNbr: '426',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LESOTHO',
      CcyNm: 'Rand',
      Ccy: 'ZAR',
      CcyNbr: '710',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LIBERIA',
      CcyNm: 'Liberian Dollar',
      Ccy: 'LRD',
      CcyNbr: '430',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LIBYA',
      CcyNm: 'Libyan Dinar',
      Ccy: 'LYD',
      CcyNbr: '434',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'LIECHTENSTEIN',
      CcyNm: 'Swiss Franc',
      Ccy: 'CHF',
      CcyNbr: '756',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LITHUANIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'LUXEMBOURG',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MACAO',
      CcyNm: 'Pataca',
      Ccy: 'MOP',
      CcyNbr: '446',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MACEDONIA (THE FORMER YUGOSLAV REPUBLIC OF)',
      CcyNm: 'Denar',
      Ccy: 'MKD',
      CcyNbr: '807',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MADAGASCAR',
      CcyNm: 'Malagasy Ariary',
      Ccy: 'MGA',
      CcyNbr: '969',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MALAWI',
      CcyNm: 'Malawi Kwacha',
      Ccy: 'MWK',
      CcyNbr: '454',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MALAYSIA',
      CcyNm: 'Malaysian Ringgit',
      Ccy: 'MYR',
      CcyNbr: '458',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MALDIVES',
      CcyNm: 'Rufiyaa',
      Ccy: 'MVR',
      CcyNbr: '462',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MALI',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'MALTA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MARSHALL ISLANDS (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MARTINIQUE',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MAURITANIA',
      CcyNm: 'Ouguiya',
      Ccy: 'MRU',
      CcyNbr: '929',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MAURITIUS',
      CcyNm: 'Mauritius Rupee',
      Ccy: 'MUR',
      CcyNbr: '480',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MAYOTTE',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MEMBER COUNTRIES OF THE AFRICAN DEVELOPMENT BANK GROUP',
      CcyNm: 'ADB Unit of Account',
      Ccy: 'XUA',
      CcyNbr: '965',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'MEXICO',
      CcyNm: 'Mexican Peso',
      Ccy: 'MXN',
      CcyNbr: '484',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MEXICO',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'Mexican Unidad de Inversion (UDI)',
      },
      Ccy: 'MXV',
      CcyNbr: '979',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MICRONESIA (FEDERATED STATES OF)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MOLDOVA (THE REPUBLIC OF)',
      CcyNm: 'Moldovan Leu',
      Ccy: 'MDL',
      CcyNbr: '498',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MONACO',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MONGOLIA',
      CcyNm: 'Tugrik',
      Ccy: 'MNT',
      CcyNbr: '496',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MONTENEGRO',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MONTSERRAT',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MOROCCO',
      CcyNm: 'Moroccan Dirham',
      Ccy: 'MAD',
      CcyNbr: '504',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MOZAMBIQUE',
      CcyNm: 'Mozambique Metical',
      Ccy: 'MZN',
      CcyNbr: '943',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'MYANMAR',
      CcyNm: 'Kyat',
      Ccy: 'MMK',
      CcyNbr: '104',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NAMIBIA',
      CcyNm: 'Namibia Dollar',
      Ccy: 'NAD',
      CcyNbr: '516',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NAMIBIA',
      CcyNm: 'Rand',
      Ccy: 'ZAR',
      CcyNbr: '710',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NAURU',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NEPAL',
      CcyNm: 'Nepalese Rupee',
      Ccy: 'NPR',
      CcyNbr: '524',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NETHERLANDS (THE)',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NEW CALEDONIA',
      CcyNm: 'CFP Franc',
      Ccy: 'XPF',
      CcyNbr: '953',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'NEW ZEALAND',
      CcyNm: 'New Zealand Dollar',
      Ccy: 'NZD',
      CcyNbr: '554',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NICARAGUA',
      CcyNm: 'Cordoba Oro',
      Ccy: 'NIO',
      CcyNbr: '558',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NIGER (THE)',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'NIGERIA',
      CcyNm: 'Naira',
      Ccy: 'NGN',
      CcyNbr: '566',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NIUE',
      CcyNm: 'New Zealand Dollar',
      Ccy: 'NZD',
      CcyNbr: '554',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NORFOLK ISLAND',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NORTHERN MARIANA ISLANDS (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'NORWAY',
      CcyNm: 'Norwegian Krone',
      Ccy: 'NOK',
      CcyNbr: '578',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'OMAN',
      CcyNm: 'Rial Omani',
      Ccy: 'OMR',
      CcyNbr: '512',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'PAKISTAN',
      CcyNm: 'Pakistan Rupee',
      Ccy: 'PKR',
      CcyNbr: '586',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PALAU',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PALESTINE, STATE OF',
      CcyNm: 'No universal currency',
    },
    {
      CtryNm: 'PANAMA',
      CcyNm: 'Balboa',
      Ccy: 'PAB',
      CcyNbr: '590',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PANAMA',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PAPUA NEW GUINEA',
      CcyNm: 'Kina',
      Ccy: 'PGK',
      CcyNbr: '598',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PARAGUAY',
      CcyNm: 'Guarani',
      Ccy: 'PYG',
      CcyNbr: '600',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'PERU',
      CcyNm: 'Sol',
      Ccy: 'PEN',
      CcyNbr: '604',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PHILIPPINES (THE)',
      CcyNm: 'Philippine Peso',
      Ccy: 'PHP',
      CcyNbr: '608',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PITCAIRN',
      CcyNm: 'New Zealand Dollar',
      Ccy: 'NZD',
      CcyNbr: '554',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'POLAND',
      CcyNm: 'Zloty',
      Ccy: 'PLN',
      CcyNbr: '985',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PORTUGAL',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'PUERTO RICO',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'QATAR',
      CcyNm: 'Qatari Rial',
      Ccy: 'QAR',
      CcyNbr: '634',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'RÉUNION',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ROMANIA',
      CcyNm: 'Romanian Leu',
      Ccy: 'RON',
      CcyNbr: '946',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'RUSSIAN FEDERATION (THE)',
      CcyNm: 'Russian Ruble',
      Ccy: 'RUB',
      CcyNbr: '643',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'RWANDA',
      CcyNm: 'Rwanda Franc',
      Ccy: 'RWF',
      CcyNbr: '646',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'SAINT BARTHÉLEMY',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA',
      CcyNm: 'Saint Helena Pound',
      Ccy: 'SHP',
      CcyNbr: '654',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT KITTS AND NEVIS',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT LUCIA',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT MARTIN (FRENCH PART)',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT PIERRE AND MIQUELON',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAINT VINCENT AND THE GRENADINES',
      CcyNm: 'East Caribbean Dollar',
      Ccy: 'XCD',
      CcyNbr: '951',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAMOA',
      CcyNm: 'Tala',
      Ccy: 'WST',
      CcyNbr: '882',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAN MARINO',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAO TOME AND PRINCIPE',
      CcyNm: 'Dobra',
      Ccy: 'STN',
      CcyNbr: '930',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SAUDI ARABIA',
      CcyNm: 'Saudi Riyal',
      Ccy: 'SAR',
      CcyNbr: '682',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SENEGAL',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'SERBIA',
      CcyNm: 'Serbian Dinar',
      Ccy: 'RSD',
      CcyNbr: '941',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SEYCHELLES',
      CcyNm: 'Seychelles Rupee',
      Ccy: 'SCR',
      CcyNbr: '690',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SIERRA LEONE',
      CcyNm: 'Leone',
      Ccy: 'SLL',
      CcyNbr: '694',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SINGAPORE',
      CcyNm: 'Singapore Dollar',
      Ccy: 'SGD',
      CcyNbr: '702',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SINT MAARTEN (DUTCH PART)',
      CcyNm: 'Netherlands Antillean Guilder',
      Ccy: 'ANG',
      CcyNbr: '532',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SISTEMA UNITARIO DE COMPENSACION REGIONAL DE PAGOS "SUCRE"',
      CcyNm: 'Sucre',
      Ccy: 'XSU',
      CcyNbr: '994',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'SLOVAKIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SLOVENIA',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SOLOMON ISLANDS',
      CcyNm: 'Solomon Islands Dollar',
      Ccy: 'SBD',
      CcyNbr: '090',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SOMALIA',
      CcyNm: 'Somali Shilling',
      Ccy: 'SOS',
      CcyNbr: '706',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SOUTH AFRICA',
      CcyNm: 'Rand',
      Ccy: 'ZAR',
      CcyNbr: '710',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS',
      CcyNm: 'No universal currency',
    },
    {
      CtryNm: 'SOUTH SUDAN',
      CcyNm: 'South Sudanese Pound',
      Ccy: 'SSP',
      CcyNbr: '728',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SPAIN',
      CcyNm: 'Euro',
      Ccy: 'EUR',
      CcyNbr: '978',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SRI LANKA',
      CcyNm: 'Sri Lanka Rupee',
      Ccy: 'LKR',
      CcyNbr: '144',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SUDAN (THE)',
      CcyNm: 'Sudanese Pound',
      Ccy: 'SDG',
      CcyNbr: '938',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SURINAME',
      CcyNm: 'Surinam Dollar',
      Ccy: 'SRD',
      CcyNbr: '968',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SVALBARD AND JAN MAYEN',
      CcyNm: 'Norwegian Krone',
      Ccy: 'NOK',
      CcyNbr: '578',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ESWATINI',
      CcyNm: 'Lilangeni',
      Ccy: 'SZL',
      CcyNbr: '748',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SWEDEN',
      CcyNm: 'Swedish Krona',
      Ccy: 'SEK',
      CcyNbr: '752',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SWITZERLAND',
      CcyNm: 'Swiss Franc',
      Ccy: 'CHF',
      CcyNbr: '756',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SWITZERLAND',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'WIR Euro',
      },
      Ccy: 'CHE',
      CcyNbr: '947',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SWITZERLAND',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'WIR Franc',
      },
      Ccy: 'CHW',
      CcyNbr: '948',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'SYRIAN ARAB REPUBLIC',
      CcyNm: 'Syrian Pound',
      Ccy: 'SYP',
      CcyNbr: '760',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TAIWAN (PROVINCE OF CHINA)',
      CcyNm: 'New Taiwan Dollar',
      Ccy: 'TWD',
      CcyNbr: '901',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TAJIKISTAN',
      CcyNm: 'Somoni',
      Ccy: 'TJS',
      CcyNbr: '972',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TANZANIA, UNITED REPUBLIC OF',
      CcyNm: 'Tanzanian Shilling',
      Ccy: 'TZS',
      CcyNbr: '834',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'THAILAND',
      CcyNm: 'Baht',
      Ccy: 'THB',
      CcyNbr: '764',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TIMOR-LESTE',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TOGO',
      CcyNm: 'CFA Franc BCEAO',
      Ccy: 'XOF',
      CcyNbr: '952',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'TOKELAU',
      CcyNm: 'New Zealand Dollar',
      Ccy: 'NZD',
      CcyNbr: '554',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TONGA',
      CcyNm: 'Pa’anga',
      Ccy: 'TOP',
      CcyNbr: '776',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TRINIDAD AND TOBAGO',
      CcyNm: 'Trinidad and Tobago Dollar',
      Ccy: 'TTD',
      CcyNbr: '780',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TUNISIA',
      CcyNm: 'Tunisian Dinar',
      Ccy: 'TND',
      CcyNbr: '788',
      CcyMnrUnts: '3',
    },
    {
      CtryNm: 'TURKEY',
      CcyNm: 'Turkish Lira',
      Ccy: 'TRY',
      CcyNbr: '949',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TURKMENISTAN',
      CcyNm: 'Turkmenistan New Manat',
      Ccy: 'TMT',
      CcyNbr: '934',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TURKS AND CAICOS ISLANDS (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'TUVALU',
      CcyNm: 'Australian Dollar',
      Ccy: 'AUD',
      CcyNbr: '036',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UGANDA',
      CcyNm: 'Uganda Shilling',
      Ccy: 'UGX',
      CcyNbr: '800',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'UKRAINE',
      CcyNm: 'Hryvnia',
      Ccy: 'UAH',
      CcyNbr: '980',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UNITED ARAB EMIRATES (THE)',
      CcyNm: 'UAE Dirham',
      Ccy: 'AED',
      CcyNbr: '784',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND (THE)',
      CcyNm: 'Pound Sterling',
      Ccy: 'GBP',
      CcyNbr: '826',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UNITED STATES MINOR OUTLYING ISLANDS (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UNITED STATES OF AMERICA (THE)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'UNITED STATES OF AMERICA (THE)',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'US Dollar (Next day)',
      },
      Ccy: 'USN',
      CcyNbr: '997',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'URUGUAY',
      CcyNm: 'Peso Uruguayo',
      Ccy: 'UYU',
      CcyNbr: '858',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'URUGUAY',
      CcyNm: {
        '@IsFund': 'true',
        '#text': 'Uruguay Peso en Unidades Indexadas (UI)',
      },
      Ccy: 'UYI',
      CcyNbr: '940',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'URUGUAY',
      CcyNm: 'Unidad Previsional',
      Ccy: 'UYW',
      CcyNbr: '927',
      CcyMnrUnts: '4',
    },
    {
      CtryNm: 'UZBEKISTAN',
      CcyNm: 'Uzbekistan Sum',
      Ccy: 'UZS',
      CcyNbr: '860',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'VANUATU',
      CcyNm: 'Vatu',
      Ccy: 'VUV',
      CcyNbr: '548',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'VENEZUELA (BOLIVARIAN REPUBLIC OF)',
      CcyNm: 'Bolívar Soberano',
      Ccy: 'VES',
      CcyNbr: '928',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'VIET NAM',
      CcyNm: 'Dong',
      Ccy: 'VND',
      CcyNbr: '704',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'VIRGIN ISLANDS (BRITISH)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'VIRGIN ISLANDS (U.S.)',
      CcyNm: 'US Dollar',
      Ccy: 'USD',
      CcyNbr: '840',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'WALLIS AND FUTUNA',
      CcyNm: 'CFP Franc',
      Ccy: 'XPF',
      CcyNbr: '953',
      CcyMnrUnts: '0',
    },
    {
      CtryNm: 'WESTERN SAHARA',
      CcyNm: 'Moroccan Dirham',
      Ccy: 'MAD',
      CcyNbr: '504',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'YEMEN',
      CcyNm: 'Yemeni Rial',
      Ccy: 'YER',
      CcyNbr: '886',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ZAMBIA',
      CcyNm: 'Zambian Kwacha',
      Ccy: 'ZMW',
      CcyNbr: '967',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ZIMBABWE',
      CcyNm: 'Zimbabwe Dollar',
      Ccy: 'ZWL',
      CcyNbr: '932',
      CcyMnrUnts: '2',
    },
    {
      CtryNm: 'ZZ01_Bond Markets Unit European_EURCO',
      CcyNm: 'Bond Markets Unit European Composite Unit (EURCO)',
      Ccy: 'XBA',
      CcyNbr: '955',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ02_Bond Markets Unit European_EMU-6',
      CcyNm: 'Bond Markets Unit European Monetary Unit (E.M.U.-6)',
      Ccy: 'XBB',
      CcyNbr: '956',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ03_Bond Markets Unit European_EUA-9',
      CcyNm: 'Bond Markets Unit European Unit of Account 9 (E.U.A.-9)',
      Ccy: 'XBC',
      CcyNbr: '957',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ04_Bond Markets Unit European_EUA-17',
      CcyNm: 'Bond Markets Unit European Unit of Account 17 (E.U.A.-17)',
      Ccy: 'XBD',
      CcyNbr: '958',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ06_Testing_Code',
      CcyNm: 'Codes specifically reserved for testing purposes',
      Ccy: 'XTS',
      CcyNbr: '963',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ07_No_Currency',
      CcyNm:
        'The codes assigned for transactions where no currency is involved',
      Ccy: 'XXX',
      CcyNbr: '999',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ08_Gold',
      CcyNm: 'Gold',
      Ccy: 'XAU',
      CcyNbr: '959',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ09_Palladium',
      CcyNm: 'Palladium',
      Ccy: 'XPD',
      CcyNbr: '964',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ10_Platinum',
      CcyNm: 'Platinum',
      Ccy: 'XPT',
      CcyNbr: '962',
      CcyMnrUnts: 'N.A.',
    },
    {
      CtryNm: 'ZZ11_Silver',
      CcyNm: 'Silver',
      Ccy: 'XAG',
      CcyNbr: '961',
      CcyMnrUnts: 'N.A.',
    },
  ],
};

const reimbursementsFrequencies = {
  BI_MONTHLY: 'BI_MONTHLY',
  MONTHLY: 'MONTHLY',
};

module.exports = {
  vowels,
  weekdays,
  allMonths,
  validTypes,
  currencies,
  dateFormats,
  loggingTags,
  reportNames,
  templatesSet,
  timezonesSet,
  httpsActions,
  canEditRules,
  addendumTypes,
  templateFields,
  shareBodyFields,
  activityStatuses,
  reportingActions,
  createBodyFields,
  updateBodyFields,
  removeBodyFields,
  commentBodyFields,
  subcollectionNames,
  sendGridTemplateIds,
  templatesWithNumber,
  changeStatusBodyFields,
  reimbursementsFrequencies,
  phoneNumberUpdateBodyFields,
  msRequestTypes,
  msEndpoints,
};
