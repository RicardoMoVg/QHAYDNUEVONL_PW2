require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// ─────────────────────────────────────────────
// GET /api/stats
// ─────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    try {
        const pool = await poolPromise;
        const r = await pool.request().query(`
            SELECT
                (SELECT COUNT(*) FROM Publicaciones WHERE estado='activo')    AS publicaciones,
                (SELECT COUNT(*) FROM Publicaciones WHERE estado='eliminado') AS publicacionesEliminadas,
                (SELECT COUNT(*) FROM Usuarios      WHERE estado='activo')    AS usuarios,
                (SELECT COUNT(*) FROM Usuarios      WHERE estado='eliminado') AS usuariosEliminados,
                (SELECT COUNT(*) FROM Comentarios   WHERE estado='activo')    AS comentarios,
                (SELECT COUNT(*) FROM Comentarios   WHERE estado='eliminado') AS comentariosEliminados
        `);
        res.json(r.recordset[0]);
    } catch (err) {
        console.error('Error en /api/stats:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/posts   — ?categoria=X
// ─────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {
    const { categoria, estado } = req.query;
    try {
        const pool    = await poolPromise;
        const request = pool.request();
        const estadoFiltro = estado || 'activo';
        request.input('estado', sql.NVarChar, estadoFiltro);
        let query = `
            SELECT p.id_publicacion, p.titulo, p.descripcion, p.imagen,
                   cat.nombre_categoria AS categoria, p.ubicacion, p.likes, p.fecha_creacion,
                   u.nombre AS autor, u.id_usuario,
                   (SELECT COUNT(*) FROM Comentarios c
                    WHERE c.id_publicacion = p.id_publicacion AND c.estado='activo') AS num_comentarios
            FROM Publicaciones p
            JOIN Usuarios u ON p.id_usuario = u.id_usuario
            LEFT JOIN Categorias cat ON p.id_categoria = cat.id_categoria
            WHERE p.estado = @estado
        `;
        if (categoria && categoria !== 'Todos') {
            query += ' AND cat.nombre_categoria = @categoria';
            request.input('categoria', sql.NVarChar, categoria);
        }
        query += ' ORDER BY p.fecha_creacion DESC';
        const result = await request.query(query);

        // Extraer sólo la primera imagen de cada post (evita respuestas enormes)
        const posts = result.recordset.map(row => {
            let primeraImagen = null;
            if (row.imagen) {
                try {
                    const arr = JSON.parse(row.imagen);
                    primeraImagen = Array.isArray(arr) && arr.length ? arr[0] : row.imagen;
                } catch {
                    primeraImagen = row.imagen;
                }
            }
            return { ...row, imagen: primeraImagen };
        });
        res.json(posts);
    } catch (err) {
        console.error('Error en GET /api/posts:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/posts/:id
// ─────────────────────────────────────────────
app.get('/api/posts/:id', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT p.id_publicacion, p.titulo, p.descripcion, p.imagen,
                       cat.nombre_categoria AS categoria, p.ubicacion, p.likes, p.fecha_creacion,
                       u.nombre AS autor, u.id_usuario,
                       (SELECT COUNT(*) FROM Comentarios c
                        WHERE c.id_publicacion = p.id_publicacion AND c.estado='activo') AS num_comentarios
                FROM Publicaciones p
                JOIN Usuarios u ON p.id_usuario = u.id_usuario
                LEFT JOIN Categorias cat ON p.id_categoria = cat.id_categoria
                WHERE p.id_publicacion = @id AND p.estado = 'activo'
            `);
        if (!result.recordset.length)
            return res.status(404).json({ error: 'Publicación no encontrada.' });
        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error en GET /api/posts/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/posts
// Espera: { titulo, descripcion, categoria, ubicacion, id_usuario }
// ─────────────────────────────────────────────
app.post('/api/posts', async (req, res) => {
    const { titulo, descripcion, categoria, ubicacion, id_usuario, imagen } = req.body;
    if (!titulo || !descripcion || !categoria || !id_usuario)
        return res.status(400).json({ error: 'Título, descripción, categoría y usuario son obligatorios.' });
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('titulo',      sql.NVarChar, titulo)
            .input('descripcion', sql.NVarChar, descripcion)
            .input('categoria',   sql.NVarChar, categoria)
            .input('ubicacion',   sql.NVarChar, ubicacion || null)
            .input('id_usuario',  sql.Int, id_usuario)
            .input('imagen',      sql.NVarChar(sql.MAX), imagen || null)
            .query(`
                INSERT INTO Publicaciones
                    (titulo, descripcion, id_categoria, ubicacion, id_usuario, imagen, likes, estado, fecha_creacion, fecha_publicacion)
                OUTPUT INSERTED.id_publicacion
                SELECT @titulo, @descripcion, id_categoria, @ubicacion, @id_usuario, @imagen, 0, 'activo', GETDATE(), GETDATE()
                FROM Categorias WHERE nombre_categoria = @categoria
            `);
        if (!result.recordset.length)
            return res.status(400).json({ error: `La categoría "${categoria}" no existe en el catálogo.` });
        res.status(201).json({ mensaje: 'Publicación creada.', id: result.recordset[0].id_publicacion });
    } catch (err) {
        console.error('Error en POST /api/posts:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/posts/:id  — soft delete
// ─────────────────────────────────────────────
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`UPDATE Publicaciones SET estado='eliminado' WHERE id_publicacion=@id`);
        res.json({ mensaje: 'Publicación eliminada.' });
    } catch (err) {
        console.error('Error en DELETE /api/posts/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/posts/:id/comments
// ─────────────────────────────────────────────
app.get('/api/posts/:id/comments', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT c.id_comentario, c.contenido, c.likes, c.fecha_creacion,
                       u.nombre AS autor, u.id_usuario
                FROM Comentarios c
                JOIN Usuarios u ON c.id_usuario = u.id_usuario
                WHERE c.id_publicacion = @id AND c.estado = 'activo'
                ORDER BY c.fecha_creacion DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en GET /api/posts/:id/comments:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/comments
// Espera: { contenido, id_usuario }
// ─────────────────────────────────────────────
app.post('/api/posts/:id/comments', async (req, res) => {
    const { contenido, id_usuario } = req.body;
    const postId = parseInt(req.params.id);

    if (!contenido || !id_usuario || isNaN(postId))
        return res.status(400).json({ error: 'Contenido, usuario y ID de publicación son obligatorios.' });

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('contenido',      sql.NVarChar, contenido)
            .input('id_publicacion', sql.Int, postId)
            .input('id_usuario',     sql.Int, parseInt(id_usuario))
            .query(`
                INSERT INTO Comentarios
                    (contenido, id_publicacion, id_usuario, likes, estado, fecha_creacion)
                VALUES (@contenido, @id_publicacion, @id_usuario, 0, 'activo', GETDATE())
            `);
        res.status(201).json({ mensaje: 'Comentario publicado.' });
    } catch (err) {
        console.error('Error en POST /api/posts/:id/comments:', err);
        res.status(500).json({ error: 'Error al guardar el comentario. Verifique la conexión con la base de datos.', detalle: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /api/comments  — todos los comentarios (moderación)
// Query: ?estado=activo|eliminado
// ─────────────────────────────────────────────
app.get('/api/comments', async (req, res) => {
    const { estado } = req.query;
    try {
        const pool    = await poolPromise;
        const request = pool.request();
        let query = `
            SELECT c.id_comentario, c.contenido, c.likes, c.fecha_creacion, c.estado,
                   u.nombre AS autor, p.titulo AS post_titulo, p.id_publicacion
            FROM Comentarios c
            JOIN Usuarios u ON c.id_usuario = u.id_usuario
            JOIN Publicaciones p ON c.id_publicacion = p.id_publicacion
        `;
        if (estado) {
            query += ' WHERE c.estado = @estado';
            request.input('estado', sql.NVarChar, estado);
        }
        query += ' ORDER BY c.fecha_creacion DESC';
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en GET /api/comments:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/comments/:id
// ─────────────────────────────────────────────
app.delete('/api/comments/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`UPDATE Comentarios SET estado='eliminado' WHERE id_comentario=@id`);
        res.json({ mensaje: 'Comentario eliminado.' });
    } catch (err) {
        console.error('Error en DELETE /api/comments/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/users   — ?estado=activo|eliminado
// ─────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
    const { estado } = req.query;
    try {
        const pool    = await poolPromise;
        const request = pool.request();
        let query = `SELECT id_usuario, nombre, correo, rol, estado, edad FROM Usuarios`;
        if (estado) {
            query += ' WHERE estado = @estado';
            request.input('estado', sql.NVarChar, estado);
        }
        query += ' ORDER BY id_usuario DESC';
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en GET /api/users:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/users/:id
// ─────────────────────────────────────────────
app.get('/api/users/:id', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT u.id_usuario, u.nombre, u.correo, u.rol, u.estado, u.edad,
                       u.descripcion, u.foto_perfil, u.foto_portada,
                       (SELECT COUNT(*) FROM Publicaciones p
                        WHERE p.id_usuario = u.id_usuario AND p.estado='activo') AS num_publicaciones,
                       (SELECT ISNULL(SUM(p.likes),0) FROM Publicaciones p
                        WHERE p.id_usuario = u.id_usuario AND p.estado='activo') AS total_likes
                FROM Usuarios u WHERE u.id_usuario = @id
            `);
        if (!result.recordset.length)
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Error en GET /api/users/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// PUT /api/users/:id  — actualizar perfil
// ─────────────────────────────────────────────
app.put('/api/users/:id', async (req, res) => {
    const { nombre, descripcion, foto_perfil, foto_portada } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id',           sql.Int,              req.params.id)
            .input('nombre',       sql.NVarChar,         nombre)
            .input('descripcion',  sql.NVarChar(500),    descripcion  || null)
            .input('foto_perfil',  sql.NVarChar(sql.MAX), foto_perfil  || null)
            .input('foto_portada', sql.NVarChar(sql.MAX), foto_portada || null)
            .query(`
                UPDATE Usuarios SET
                    nombre       = @nombre,
                    descripcion  = @descripcion,
                    foto_perfil  = CASE WHEN @foto_perfil  IS NOT NULL THEN @foto_perfil  ELSE foto_perfil  END,
                    foto_portada = CASE WHEN @foto_portada IS NOT NULL THEN @foto_portada ELSE foto_portada END
                WHERE id_usuario = @id`);
        res.json({ mensaje: 'Perfil actualizado correctamente.' });
    } catch (err) {
        console.error('Error en PUT /api/users/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/users/:id/posts  — publicaciones del usuario
// ─────────────────────────────────────────────
app.get('/api/users/:id/posts', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT p.id_publicacion, p.titulo, p.descripcion, p.imagen,
                       cat.nombre_categoria AS categoria, p.ubicacion,
                       p.likes, p.fecha_creacion,
                       (SELECT COUNT(*) FROM Comentarios c
                        WHERE c.id_publicacion = p.id_publicacion AND c.estado='activo') AS num_comentarios
                FROM Publicaciones p
                LEFT JOIN Categorias cat ON p.id_categoria = cat.id_categoria
                WHERE p.id_usuario = @id AND p.estado = 'activo'
                ORDER BY p.fecha_creacion DESC
            `);
        const posts = result.recordset.map(row => {
            let img = null;
            if (row.imagen) {
                try { const a = JSON.parse(row.imagen); img = Array.isArray(a) && a.length ? a[0] : row.imagen; }
                catch { img = row.imagen; }
            }
            return { ...row, imagen: img };
        });
        res.json(posts);
    } catch (err) {
        console.error('Error en GET /api/users/:id/posts:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// ─────────────────────────────────────────────
// DELETE /api/users/:id  — desactivar usuario
// ─────────────────────────────────────────────
app.delete('/api/users/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`UPDATE Usuarios SET estado='eliminado' WHERE id_usuario=@id`);
        res.json({ mensaje: 'Usuario eliminado.' });
    } catch (err) {
        console.error('Error en DELETE /api/users/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/categorias
// ─────────────────────────────────────────────
app.get('/api/categorias', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT c.id_categoria, c.nombre_categoria AS nombre,
                   (SELECT COUNT(*) FROM Publicaciones p
                    WHERE p.id_categoria = c.id_categoria AND p.estado='activo') AS num_publicaciones
            FROM Categorias c ORDER BY c.nombre_categoria
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en GET /api/categorias:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/categorias  — { nombre }
// ─────────────────────────────────────────────
app.post('/api/categorias', async (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .query(`INSERT INTO Categorias (nombre_categoria) VALUES (@nombre)`);
        res.status(201).json({ mensaje: 'Categoría creada.' });
    } catch (err) {
        console.error('Error en POST /api/categorias:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/categorias/:id
// ─────────────────────────────────────────────
app.delete('/api/categorias/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`DELETE FROM Categorias WHERE id_categoria=@id`);
        res.json({ mensaje: 'Categoría eliminada.' });
    } catch (err) {
        console.error('Error en DELETE /api/categorias/:id:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${port}`);
});