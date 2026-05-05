require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    port: 63256,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function updateSchema() {
    try {
        console.log('Conectando a la base de datos...');
        const pool = await sql.connect(dbConfig);
        console.log('Conexión exitosa.');

        const queries = [
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Publicaciones') AND name = 'id_moderador')
             ALTER TABLE Publicaciones ADD id_moderador INT;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Publicaciones') AND name = 'fecha_moderacion')
             ALTER TABLE Publicaciones ADD fecha_moderacion DATETIME;`,

            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Usuarios') AND name = 'id_moderador')
             ALTER TABLE Usuarios ADD id_moderador INT;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Usuarios') AND name = 'fecha_moderacion')
             ALTER TABLE Usuarios ADD fecha_moderacion DATETIME;`,

            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Comentarios') AND name = 'id_moderador')
             ALTER TABLE Comentarios ADD id_moderador INT;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Comentarios') AND name = 'fecha_moderacion')
             ALTER TABLE Comentarios ADD fecha_moderacion DATETIME;`,

            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Usuarios') AND name = 'tipo_perfil')
             ALTER TABLE Usuarios ADD tipo_perfil NVARCHAR(50) DEFAULT 'personal';`
        ];

        for (const query of queries) {
            console.log(`Ejecutando: ${query}`);
            await pool.request().query(query);
        }

        console.log('Esquema actualizado correctamente.');
        await pool.close();
    } catch (err) {
        console.error('Error al actualizar el esquema:', err);
    }
}

updateSchema();
