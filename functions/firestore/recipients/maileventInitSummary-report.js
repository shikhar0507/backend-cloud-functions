const {db} = require('../../admin/admin');
const momentTz = require('moment-timezone');
const XlsxPopulate = require('xlsx-populate');
const {dateFormats} = require('../../admin/constants');
const {alphabetsArray} = require('./report-utils');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const maileventInitSummaryReport = async () => {
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

  const serverRef = db.collection('MailEvents');
  let querySnapshot = await serverRef
    .where('timestamp', '>=', momentTz(start).unix())
    .where('timestamp', '<=', momentTz(end).unix())
    .get();
  if (querySnapshot) {
    const mailEventsDocs = querySnapshot.docs.map(doc => doc.data());

    let sortedQuery = mailEventsDocs.sort(
      (a, b) =>
        (a.office > b.office ? 1 : -1) ||
        (a.reportName > b.reportName ? 1 : -1),
    );

    sortedQuery.forEach(itm => {
      itm.timestamp = momentTz(itm.timestamp * 1000).format(
        dateFormats.DATE_TIME,
      );
    });

    let hash = Object.create(null);
    let grouped = [];

    sortedQuery.forEach(function(o) {
      var key = ['office', 'reportName']
        .map(function(k) {
          return o[k];
        })
        .join('|');

      if (!hash[key]) {
        hash[key] = {office: o.office, reportName: o.reportName, email: ''};
        grouped.push(hash[key]);
      }
      ['email'].forEach(function(k) {
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

      const newArrayOfObj = newArray.map(({report: reportName, ...rest}) => ({
        reportName,
        ...rest,
      }));

      const result = Object.values(
        newArrayOfObj.reduce(function(r, e) {
          var key = e.office + '|' + e.reportName;
          if (!r[key]) r[key] = e;
          else {
            r[key].totalUsers += e.totalUsers;
            r[key].rowsCount += e.rowsCount
          }
          return r;
        }, {}),
      );
      const groupedExtend = grouped.map(v => ({
        ...v,
        totalUsers: 0,
        rowsCount: 0,
      }));

      const concatArray = [...groupedExtend, ...result];
      const finalResult = Object.values(
        concatArray.reduce(function(r, e) {
          let key = e.office + '|' + e.reportName;
          if (!r[key]) r[key] = e;
          else {
            r[key].totalUsers += e.totalUsers;
            r[key].rowsCount += e.rowsCount;
          }
          return r;
        }, {}),
      );

      // const SummaryReport = finalResult.map(Object.values);

      const newArraySummary = finalResult.map(({totalUsers, rowsCount}) => ({
        totalUsers,
        rowsCount,
      }));
      const summaryofReports = newArraySummary.map(e => [
        '' + JSON.stringify(e),
      ]);

      let column = 2;

      const reports = async () => {
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
        locals.messageObject.attachments.push({
          fileName:
            `MaileventInitSummary Report_` +
            `${locals.officeDoc.get('office')}` +
            `_${momentToday.format(dateFormats.DATE)}.xlsx`,
          content: await worksheet.outputAsync('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });
      };
      reports();
    }
  }
  return Promise.all([locals.sgMail.sendMultiple(locals.messageObject)]);
};
module.exports = {maileventInitSummaryReport};
