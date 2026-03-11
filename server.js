require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    port: 63256, // Puerto TCP dinámico capturado de la instancia SQL Server
    options: {
        encrypt: false, // Cambiado a false para entorno local
        trustServerCertificate: true
    }
};

// Creamos un pool de conexión global
const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ Conectado a SQL Server (db_PW2)');
        return pool;
    })
    .catch(err => {
        console.error('❌ Error al crear el pool de conexión:', err);
        process.exit(1); // Detiene la app si no hay base de datos
    });

app.get('/', (req, res) => {
    res.send('API de ¿Qué hay de nuevo, Nuevo León? funcionando correctamente.');
});

// ───────────────────────────────────────────────
// POST /api/auth/register  — Registrar usuario
// Espera: { nombre, edad, correo, password }
// ───────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    const { nombre, edad, correo, password } = req.body;

    if (!nombre || !edad || !correo || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        const pool = await poolPromise;

        // Verificar si el correo ya existe
        const existing = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .query('SELECT id_usuario FROM Usuarios WHERE correo = @correo');

        if (existing.recordset.length > 0) {
            return res.status(409).json({ error: 'El correo ya está registrado.' });
        }

        const hash = await bcrypt.hash(password, 10);

        await pool.request()
            .input('nombre',     sql.NVarChar, nombre)
            .input('edad',       sql.NVarChar, String(edad))
            .input('correo',     sql.NVarChar, correo)
            .input('contrasena', sql.NVarChar, hash)
            .query(`INSERT INTO Usuarios (nombre, edad, correo, contraseña, rol, estado)
                    VALUES (@nombre, @edad, @correo, @contrasena, 'usuario', 'activo')`);

        res.status(201).json({ mensaje: 'Usuario registrado correctamente.' });
    } catch (err) {
        console.error('Error en /register:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ───────────────────────────────────────────────
// POST /api/auth/login  — Iniciar sesión
// Espera: { correo, password }
// ───────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
    }

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .query(`SELECT id_usuario, nombre, correo, contraseña, rol, estado
                    FROM Usuarios WHERE correo = @correo`);

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        const usuario = result.recordset[0];

        if (usuario.estado !== 'activo') {
            return res.status(403).json({ error: 'Tu cuenta está desactivada.' });
        }

        const passwordValida = await bcrypt.compare(password, usuario.contraseña);

        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        // Devolvemos datos básicos del usuario (sin la contraseña)
        res.json({
            mensaje: 'Inicio de sesión exitoso.',
            usuario: {
                id:     usuario.id_usuario,
                nombre: usuario.nombre,
                correo: usuario.correo,
                rol:    usuario.rol,
                estado: usuario.estado
            }
        });
    } catch (err) {
        console.error('Error en /login:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.get('/api/test-db', async (req, res) => {
    try {
        const pool = await poolPromise; // Usamos el pool ya conectado
        const result = await pool.request().query('SELECT \'Conexión a db_PW2 exitosa\' as Mensaje');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Error en la consulta', detalles: err.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${port}`);
});