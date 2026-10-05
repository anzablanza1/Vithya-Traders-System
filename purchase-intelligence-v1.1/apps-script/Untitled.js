function whereAmI(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Bound sheet: ' + (ss ? ss.getName() : 'NONE - standalone!'));
  Logger.log('Sheet URL  : ' + (ss ? ss.getUrl() : '-'));
  Logger.log('Web app URL: ' + ScriptApp.getService().getUrl());
  Logger.log('Token first6: ' + String(API_TOKEN).slice(0,6));
}