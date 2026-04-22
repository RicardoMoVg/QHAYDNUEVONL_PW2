require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Sequelize, DataTypes, Op } = require('sequelize');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ════════════════════════════════════════════════════════════════
// 1. CONEXIÓN AL ORM (Sequelize)
// ════════════════════════════════════════════════════════════════
const sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_SERVER || 'localhost',
    dialect: 'mssql',
    port: 63256,
    dialectOptions: { options: { encrypt: false, trustServerCertificate: true } },
    logging: false // Evita que la terminal se llene de texto SQL
});

sequelize.authenticate()
    .then(() => console.log('✅ Conectado a SQL Server vía Sequelize (db_PW2)'))
    .catch(err => {
        console.error('❌ Error al conectar con Sequelize:', err);
        process.exit(1);
    });

// ════════════════════════════════════════════════════════════════
// 2. MODELOS Y RELACIONES
// ════════════════════════════════════════════════════════════════
const Usuario = sequelize.define('Usuario', {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING, allowNull: false },
    correo: { type: DataTypes.STRING, allowNull: false },
    contraseña: { type: DataTypes.STRING, allowNull: false },
    edad: { type: DataTypes.STRING },
    rol: { type: DataTypes.STRING, defaultValue: 'usuario' },
    estado: { type: DataTypes.STRING, defaultValue: 'activo' },
    descripcion: { type: DataTypes.STRING(500) },
    foto_perfil: { type: DataTypes.TEXT },
    foto_portada: { type: DataTypes.TEXT },
    id_moderador: { type: DataTypes.INTEGER },
    fecha_moderacion: { type: DataTypes.DATE }
}, { tableName: 'Usuarios', timestamps: false });

const Categoria = sequelize.define('Categoria', {
    id_categoria: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre_categoria: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'Categorias', timestamps: false });

const Publicacion = sequelize.define('Publicacion', {
    id_publicacion: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    titulo: { type: DataTypes.STRING, allowNull: false },
    descripcion: { type: DataTypes.STRING, allowNull: false },
    ubicacion: { type: DataTypes.STRING },
    imagen: { type: DataTypes.TEXT },
    likes: { type: DataTypes.INTEGER, defaultValue: 0 },
    estado: { type: DataTypes.STRING, defaultValue: 'activo' },
    fecha_creacion: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    id_usuario: { type: DataTypes.INTEGER },
    id_categoria: { type: DataTypes.INTEGER },
    id_moderador: { type: DataTypes.INTEGER },
    fecha_moderacion: { type: DataTypes.DATE }
}, { tableName: 'Publicaciones', timestamps: false });

const Comentario = sequelize.define('Comentario', {
    id_comentario: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    contenido: { type: DataTypes.STRING, allowNull: false },
    likes: { type: DataTypes.INTEGER, defaultValue: 0 },
    estado: { type: DataTypes.STRING, defaultValue: 'activo' },
    fecha_comentario: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    id_publicacion: { type: DataTypes.INTEGER },
    id_usuario: { type: DataTypes.INTEGER },
    id_moderador: { type: DataTypes.INTEGER },
    fecha_moderacion: { type: DataTypes.DATE }
}, { tableName: 'Comentarios', timestamps: false });

// -- Relaciones --
Usuario.hasMany(Publicacion, { foreignKey: 'id_usuario' });
Publicacion.belongsTo(Usuario, { foreignKey: 'id_usuario', as: 'autor' });
Publicacion.belongsTo(Usuario, { foreignKey: 'id_moderador', as: 'modPost' });

Categoria.hasMany(Publicacion, { foreignKey: 'id_categoria' });
Publicacion.belongsTo(Categoria, { foreignKey: 'id_categoria', as: 'categoriaData' });

Usuario.hasMany(Comentario, { foreignKey: 'id_usuario' });
Comentario.belongsTo(Usuario, { foreignKey: 'id_usuario', as: 'autor' });
Comentario.belongsTo(Usuario, { foreignKey: 'id_moderador', as: 'modCom' });

Publicacion.hasMany(Comentario, { foreignKey: 'id_publicacion', as: 'comentariosList' });
Comentario.belongsTo(Publicacion, { foreignKey: 'id_publicacion', as: 'postData' });

Usuario.belongsTo(Usuario, { foreignKey: 'id_moderador', as: 'modUser' });

// ════════════════════════════════════════════════════════════════
// 3. RUTAS DE LA API
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('API funcionando con Sequelize ORM.'));
app.get('/api/test-db', async (req, res) => res.json([{ Mensaje: 'Conexión a db_PW2 exitosa' }]));

// ── AUTH ──
app.post('/api/auth/register', async (req, res) => {
    const { nombre, edad, correo, password } = req.body;
    if (!nombre || !edad || !correo || !password) return res.status(400).json({ error: 'Faltan campos.' });
    try {
        const existe = await Usuario.findOne({ where: { correo } });
        if (existe) return res.status(409).json({ error: 'Correo registrado.' });
        const hash = await bcrypt.hash(password, 10);
        await Usuario.create({ nombre, edad: String(edad), correo, contraseña: hash });
        res.status(201).json({ mensaje: 'Usuario registrado.' });
    } catch (err) { res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        const user = await Usuario.findOne({ where: { correo } });
        if (!user || user.estado !== 'activo') return res.status(401).json({ error: 'Credenciales inválidas.' });
        const valid = await bcrypt.compare(password, user.contraseña);
        if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas.' });
        res.json({ mensaje: 'Éxito.', usuario: { id: user.id_usuario, nombre: user.nombre, correo: user.correo, rol: user.rol, estado: user.estado } });
    } catch (err) { res.status(500).json({ error: 'Error interno.' }); }
});

// ── ESTADÍSTICAS ──
app.get('/api/stats', async (req, res) => {
    try {
        const [pubs, pubsDel, users, usersDel, comms, commsDel] = await Promise.all([
            Publicacion.count({ where: { estado: 'activo' } }),
            Publicacion.count({ where: { estado: 'eliminado' } }),
            Usuario.count({ where: { estado: 'activo' } }),
            Usuario.count({ where: { estado: 'eliminado' } }),
            Comentario.count({ where: { estado: 'activo' } }),
            Comentario.count({ where: { estado: 'eliminado' } })
        ]);
        res.json({ publicaciones: pubs, publicacionesEliminadas: pubsDel, usuarios: users, usuariosEliminados: usersDel, comentarios: comms, comentariosEliminados: commsDel });
    } catch (err) { res.status(500).json({ error: 'Error interno.' }); }
});

// ── PUBLICACIONES ──
app.get('/api/posts', async (req, res) => {
    const { categoria, estado, busqueda } = req.query;
    try {
        const whereClause = { estado: estado && estado !== 'todos' ? estado : 'activo' };
        if (busqueda) whereClause.titulo = busqueda;

        const includes = [
            { model: Usuario, as: 'autor', attributes: ['id_usuario', 'nombre'] },
            { model: Usuario, as: 'modPost', attributes: ['nombre'] },
            { model: Comentario, as: 'comentariosList', where: { estado: 'activo' }, required: false }
        ];

        if (categoria && categoria !== 'Todos') includes.push({ model: Categoria, as: 'categoriaData', where: { nombre_categoria: categoria } });
        else includes.push({ model: Categoria, as: 'categoriaData' });

        const postsRaw = await Publicacion.findAll({ where: whereClause, include: includes, order: [['fecha_creacion', 'DESC']] });

        const posts = postsRaw.map(p => {
            const data = p.toJSON();
            let img = data.imagen;
            if (img) { try { const arr = JSON.parse(img); img = Array.isArray(arr) ? arr[0] : img; } catch { } }
            return { ...data, autor: data.autor?.nombre, moderador: data.modPost?.nombre, categoria: data.categoriaData?.nombre_categoria, num_comentarios: data.comentariosList?.length || 0, imagen: img };
        });
        res.json(posts);
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const p = await Publicacion.findOne({
            where: { id_publicacion: req.params.id, estado: 'activo' },
            include: [{ model: Usuario, as: 'autor' }, { model: Categoria, as: 'categoriaData' }, { model: Comentario, as: 'comentariosList', where: { estado: 'activo' }, required: false }]
        });
        if (!p) return res.status(404).json({ error: 'No encontrada.' });
        const data = p.toJSON();
        res.json({ ...data, autor: data.autor?.nombre, categoria: data.categoriaData?.nombre_categoria, num_comentarios: data.comentariosList?.length || 0 });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.post('/api/posts', async (req, res) => {
    const { titulo, descripcion, categoria, ubicacion, id_usuario, imagen } = req.body;
    try {
        const cat = await Categoria.findOne({ where: { nombre_categoria: categoria } });
        if (!cat) return res.status(400).json({ error: 'Categoría no existe.' });
        const post = await Publicacion.create({ titulo, descripcion, ubicacion, imagen, id_usuario, id_categoria: cat.id_categoria });
        res.status(201).json({ mensaje: 'Publicación creada.', id: post.id_publicacion });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const p = await Publicacion.findOne({ where: { id_publicacion: req.params.id, estado: 'activo' } });
        if (!p) return res.status(404).json({ error: 'No existe.' });
        p.likes += 1; await p.save();
        res.json({ likes: p.likes });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        await Publicacion.update({ estado: 'eliminado', id_moderador: req.body.id_moderador || null, fecha_moderacion: new Date() }, { where: { id_publicacion: req.params.id } });
        res.json({ mensaje: 'Eliminada.' });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

// ── COMENTARIOS ──
app.get('/api/posts/:id/comments', async (req, res) => {
    try {
        const comms = await Comentario.findAll({ where: { id_publicacion: req.params.id, estado: 'activo' }, include: [{ model: Usuario, as: 'autor' }], order: [['fecha_comentario', 'ASC']] });
        res.json(comms.map(c => ({ ...c.toJSON(), autor: c.autor?.nombre })));
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.post('/api/posts/:id/comments', async (req, res) => {
    try {
        const c = await Comentario.create({ contenido: req.body.contenido, id_publicacion: req.params.id, id_usuario: req.body.id_usuario });
        res.status(201).json({ mensaje: 'Comentario publicado.', id: c.id_comentario });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.get('/api/comments', async (req, res) => {
    const { estado } = req.query;
    try {
        const comms = await Comentario.findAll({
            where: estado && estado !== 'todos' ? { estado } : {},
            include: [{ model: Usuario, as: 'autor' }, { model: Usuario, as: 'modCom' }, { model: Publicacion, as: 'postData' }],
            order: [['fecha_comentario', 'DESC']]
        });
        res.json(comms.map(c => ({ ...c.toJSON(), autor: c.autor?.nombre, moderador: c.modCom?.nombre, post_titulo: c.postData?.titulo })));
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.post('/api/comments/:id/like', async (req, res) => {
    try {
        const c = await Comentario.findOne({ where: { id_comentario: req.params.id, estado: 'activo' } });
        c.likes += 1; await c.save();
        res.json({ likes: c.likes });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.delete('/api/comments/:id', async (req, res) => {
    try {
        await Comentario.update({ estado: 'eliminado', id_moderador: req.body.id_moderador || null, fecha_moderacion: new Date() }, { where: { id_comentario: req.params.id } });
        res.json({ mensaje: 'Comentario eliminado.' });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

// ── USUARIOS Y PERFILES ──
app.get('/api/users', async (req, res) => {
    const { estado } = req.query;
    try {
        const users = await Usuario.findAll({
            where: estado && estado !== 'todos' ? { estado } : {},
            include: [{ model: Usuario, as: 'modUser', attributes: ['nombre'] }],
            order: [['id_usuario', 'DESC']]
        });
        res.json(users.map(u => ({ ...u.toJSON(), moderador: u.modUser?.nombre })));
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const u = await Usuario.findByPk(req.params.id);
        if (!u) return res.status(404).json({ error: 'No encontrado.' });
        const num_pubs = await Publicacion.count({ where: { id_usuario: req.params.id, estado: 'activo' } });
        const total_likes = await Publicacion.sum('likes', { where: { id_usuario: req.params.id, estado: 'activo' } }) || 0;
        res.json({ ...u.toJSON(), num_publicaciones: num_pubs, total_likes });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { nombre, descripcion, foto_perfil, foto_portada } = req.body;
        const u = await Usuario.findByPk(req.params.id);
        await u.update({ nombre, descripcion, foto_perfil: foto_perfil || u.foto_perfil, foto_portada: foto_portada || u.foto_portada });
        res.json({ mensaje: 'Perfil actualizado.' });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.get('/api/users/:id/posts', async (req, res) => {
    try {
        const posts = await Publicacion.findAll({
            where: { id_usuario: req.params.id, estado: 'activo' },
            include: [{ model: Categoria, as: 'categoriaData' }, { model: Comentario, as: 'comentariosList', where: { estado: 'activo' }, required: false }],
            order: [['fecha_creacion', 'DESC']]
        });
        res.json(posts.map(p => ({ ...p.toJSON(), categoria: p.categoriaData?.nombre_categoria, num_comentarios: p.comentariosList?.length || 0 })));
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        await Usuario.update({ estado: 'eliminado', id_moderador: req.body.id_moderador || null, fecha_moderacion: new Date() }, { where: { id_usuario: req.params.id } });
        res.json({ mensaje: 'Usuario eliminado.' });
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

// ── CATEGORÍAS ──
app.get('/api/categorias', async (req, res) => {
    try {
        const cats = await Categoria.findAll({ order: [['nombre_categoria', 'ASC']] });
        const result = await Promise.all(cats.map(async c => {
            const num = await Publicacion.count({ where: { id_categoria: c.id_categoria, estado: 'activo' } });
            return { id_categoria: c.id_categoria, nombre: c.nombre_categoria, num_publicaciones: num };
        }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.post('/api/categorias', async (req, res) => {
    try { await Categoria.create({ nombre_categoria: req.body.nombre }); res.status(201).json({ mensaje: 'Creada.' }); }
    catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.delete('/api/categorias/:id', async (req, res) => {
    try { await Categoria.destroy({ where: { id_categoria: req.params.id } }); res.json({ mensaje: 'Eliminada.' }); }
    catch (err) { res.status(500).json({ error: 'Error.' }); }
});

app.listen(port, () => console.log(`🚀 Servidor ORM escuchando en http://localhost:${port}`));