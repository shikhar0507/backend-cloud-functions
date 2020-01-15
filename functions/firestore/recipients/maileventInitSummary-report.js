const {db} = require('../../admin/admin');
const momentTz = require('moment-timezone');
const XlsxPopulate = require('xlsx-populate');
const {dateFormats} = require('../../admin/constants');
const {alphabetsArray} = require('./report-utils');
const sgMail = require('@sendgrid/mail');
const env = require('../../admin/env');
sgMail.setApiKey(env.sgMailApiKey);
const maileventInitSummaryReport = async () => {
  const momentToday = momentTz();
  const start = momentTz()
    .subtract(1, 'days')
    .startOf('day')
    .toString();

  const end = momentTz()
    .subtract(1, 'days')
    .endOf('day')
    .toString();
  const headers = [
    'Office Name',
    'Report Name',
    'Recipients',
    'Process',
    'Recieved',
    'Opened',
    'Summary Report',
  ];

  const messageObject = {
    subject: `MailEvents/Inits Summary Report ${momentToday.format(
      dateFormats.DATE,
    )}`,
    cc: '',
    html: `Mail events/inits summary report`,
    to: env.instantEmailRecipientEmails,
    replyTo: env.mailReplyTo,
    attachments: [],
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    dynamic_template_data: {
      office: '',
      subject: `MaileventInitSummary Report ${momentToday.format(dateFormats.DATE)}`,
      date: momentToday.format(dateFormats.DATE),
    },
  };


  const serverRef = db.collection('MailEvents');
  let querySnapshot = await serverRef
    .where('timestamp', '>=', momentTz(start).unix())
    .where('timestamp', '<=', momentTz(end).unix())
    .get();
  if (querySnapshot) {
    const mailEventsDocs = querySnapshot.docs.map(doc => doc.data());

    const sortedQuery = mailEventsDocs.sort(
      (a, b) =>
        (a.office > b.office ? 1 : -1) ||
        (a.reportName > b.reportName ? 1 : -1),
    );

    sortedQuery.forEach(itm => {
      itm.timestamp = momentTz(itm.timestamp * 1000).format(
        dateFormats.DATE_TIME,
      );
    });

    const hash = Object.create(null);
    const grouped = [];

    sortedQuery.forEach((o)=> {
      const key = ['office', 'reportName']
        .map(function(k) {
          return o[k];
        })
        .join('|');

      if (!hash[key]) {
        hash[key] = {office: o.office, reportName: o.reportName, email: ''};
        grouped.push(hash[key]);
      }
      ['email'].forEach((k)=> {
        if (hash[key] && !hash[key][k].includes(o[k])) {
          hash[key][k] += o[k] + ',';
        }
      });
    });
    const outputData = grouped.map(Object.values);
    const newArrs = grouped.map(({email}) => ({email}));
    const emailArray = newArrs.map(o => Object.keys(o).map(k => o[k]));

    const query = db.collection('Inits');
    querySnapshot = await query
      .where('report', 'in', ['payroll', 'footprints', 'reimbursement'])

      .get();
    if (querySnapshot) {
      const docs = querySnapshot.docs.map(doc => doc.data());

      const yesterdayData = docs.filter(itm => {
        return (
          itm.timestamp >= momentTz(start).valueOf() &&
          itm.timestamp <= momentTz(end).valueOf()
        );
      });

      yesterdayData.forEach(itm => {
        itm.timestamp = momentTz(itm.timestamp).format(dateFormats.DATE_TIME);
      });

      //pick certain fields from array of objects

      const newArray = yesterdayData.map(
        ({report, rowsCount, totalUsers, office, timestamp}) => ({
          report,
          totalUsers,
          rowsCount,
          office,
          timestamp,
        }),
      );

      const newArrayOfObj = newArray.map(arrayofObj => ({
        reportName: arrayofObj.report,
        totalUsers: arrayofObj.totalUsers,
        rowsCount: arrayofObj.rowsCount,
        office: arrayofObj.office,
        timestamp: arrayofObj.timestamp,
      }));

      const result = Object.values(
        newArrayOfObj.reduce((r, e) =>{
          const key = e.office + '|' + e.reportName;
          if (!r[key]) r[key] = e;
          else {
            r[key].totalUsers += e.totalUsers;
            r[key].rowsCount += e.rowsCount;
          }
          return r;
        }, {}),
      );
      const groupedExtend = grouped.map((el) =>{
        const o = Object.assign({}, el);
        o.totalUsers = 0;
        o.rowsCount = 0;
        return o;
      });

      const concatArray = [...groupedExtend, ...result];
      const finalResult = Object.values(
        concatArray.reduce((r, e)=> {
          const key = e.office + '|' + e.reportName;
          if (!r[key]) r[key] = e;
          else {
            r[key].totalUsers += e.totalUsers;
            r[key].rowsCount += e.rowsCount;
          }
          return r;
        }, {}),
      );
      const newArraySummary = finalResult.map(({totalUsers, rowsCount}) => ({
        totalUsers,
        rowsCount,
      }));
      const summaryofReports = newArraySummary.map(e => [
        '' + JSON.stringify(e),
      ]);

      const column = 2;

      const reportSummary = async () => {
        const worksheet = await XlsxPopulate.fromBlankAsync();
        const reportSheet = worksheet.sheet(0).name('Report Detail');
        const reportSheets = (
          outputData,
          emailArray,
          summaryofReports,
          reportSheet,
        ) => {
          headers.forEach((val, index) => {
            reportSheet
              .cell(`${alphabetsArray[index]}1`)
              .style('bold', true)
              .value(val);
          });
          reportSheet.cell(`A${column}`).value(outputData);
          reportSheet.cell(`D${column}`).value(emailArray);
          reportSheet.cell(`E${column}`).value(emailArray);
          reportSheet.cell(`F${column}`).value(emailArray);
          reportSheet.cell(`G${column}`).value(summaryofReports);
        };
        reportSheets(outputData, emailArray, summaryofReports, reportSheet);
        messageObject.attachments.push({
          fileName: `MaileventInitSummary Report ${momentToday.format(
            dateFormats.DATE,
          )}.xlsx`,
          content: await worksheet.outputAsync('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });

        return sgMail.sendMultiple(messageObject);
      };
      reportSummary();
    }
  }
  return ;
};
module.exports = {maileventInitSummaryReport};
