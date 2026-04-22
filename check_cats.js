require('dotenv').config();
const sql = require('mssql');
const cfg = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE,
  port: 63256, options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(pool =>
  pool.request().query("SELECT id_categoria, nombre_categoria FROM Categorias ORDER BY id_categoria")
).then(r => { console.log('Categorias existentes:', r.recordset); sql.close(); })
 .catch(e => { console.error('Error:', e.message); sql.close(); });
