window.onload = function () {
  var hdb = require('hdb');

  var client = hdb.createClient({
    host: '*******',
    port: 30015,
    user: 'SYSTEM',
    password: '******'
  });

  var command = document.querySelector('textarea');
  var button = document.querySelector('button');

  function showMessage(msg) {
    result.textContent = msg;
  }

  function showError(err) {
    showMessage(err.message);
  }

 function showResult(metadata, rows) {
   var columns = metadata.map(function(column){
     return column.columnDisplayName;
   });
   var data = rows.map(function(row){
     return columns.map(function(column){
       return '' + row[column];
     });
   });
   var dable = new Dable();
   dable.SetDataAsRows(data);
   dable.SetColumnNames(columns);
   dable.BuildAll('result');
 }

  button.onclick = function execute(){
    if (client.readyState !== 'connected') {
       return showError(new Error('Not connected'));
    }
    client.execute(command.value, function done(err, rs){
      if (err) {
        return showError(err);
      }
       rs.fetch(function(err, rows){
      if (err) {
        return showError(err);
       }
       showResult(rs.metadata, rows);
     });
    });
  };

  client.connect(function (err) {
    if (err) {
      return showError(err);
    }
  });
};
