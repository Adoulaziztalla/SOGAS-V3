// Fichier: backend/routes/employee/employeeRoutes.js

const express = require('express');
const Joi = require('joi');
const db = require('../../config/db');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// Schéma de validation pour la création initiale d'un employé (seulement les champs requis)
const employeeCreationSchema = Joi.object({
    // Données de base
    matricule: Joi.string().max(50).required(), // Unique et obligatoire
    nom: Joi.string().required(),
    prenom: Joi.string().required(),
    genre: Joi.string().valid('M', 'F', 'Autre').required(),
    date_naissance: Joi.date().iso().required(),
    
    // Affectation initiale (Doit être valide)
    site_id: Joi.number().integer().min(1).required(),
    department_id: Joi.number().integer().min(1).required(),
    service_id: Joi.number().integer().min(1).required(),
    team_id: Joi.number().integer().min(1).required(),
    position: Joi.string().max(255).required(), // Poste actuel
    fonction: Joi.string().max(255).required(), // Fonction actuelle
    
    // Données contact d'urgence minimales
    telephone_principal: Joi.string().max(50).required(),
    contact_urgence_nom: Joi.string().max(255).required(),
    contact_urgence_telephone: Joi.string().max(50).required(),

    // L'ID utilisateur (user_id) est optionnel à la création
    user_id: Joi.number().integer().optional().allow(null) 
});

// Route pour créer un nouvel employé (POST /api/employee)
router.post('/', authMiddleware, async (req, res) => {
    // Utilisation d'une transaction pour garantir l'intégrité des données
    // Si une insertion échoue, toutes les insertions précédentes sont annulées.
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const { error, value } = employeeCreationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const {
            matricule, nom, prenom, genre, date_naissance,
            site_id, department_id, service_id, team_id, position, fonction,
            telephone_principal, contact_urgence_nom, contact_urgence_telephone, user_id
        } = value;

        // 1. Validation : Vérification de l'unicité du matricule
        const [existing] = await connection.query('SELECT matricule FROM employees WHERE matricule = ?', [matricule]);
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'Ce matricule existe déjà. Unicité requise.' });
        }
        
        // 2. Validation de l'existence des IDs de la structure
        // On vérifie que le Site, Dept, Service, Team existent avant d'insérer
        const [structureCheck] = await connection.query(`
            SELECT 
                (SELECT COUNT(*) FROM sites WHERE id = ?) AS site_exists,
                (SELECT COUNT(*) FROM departments WHERE id = ?) AS dept_exists,
                (SELECT COUNT(*) FROM services WHERE id = ?) AS service_exists,
                (SELECT COUNT(*) FROM teams WHERE id = ?) AS team_exists
        `, [site_id, department_id, service_id, team_id]);
        
        if (structureCheck[0].site_exists === 0 || structureCheck[0].dept_exists === 0 || structureCheck[0].service_exists === 0 || structureCheck[0].team_exists === 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Erreur: L\'une des affectations (Site, Département, Service, Équipe) n\'existe pas.' });
        }

        // 3. Insertion dans la table `employees`
        const [empResult] = await connection.query(`
            INSERT INTO employees (matricule, nom, prenom, site_id, department_id, service_id, team_id, position, fonction, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [matricule, nom, prenom, site_id, department_id, service_id, team_id, position, fonction, user_id]);

        const employeeId = empResult.insertId;

        // 4. Insertion dans la table `employee_personal`
        await connection.query(`
            INSERT INTO employee_personal (employee_id, date_naissance, genre)
            VALUES (?, ?, ?)
        `, [employeeId, date_naissance, genre]);
        
        // 5. Insertion dans la table `employee_contact`
        await connection.query(`
            INSERT INTO employee_contact (employee_id, telephone_principal, contact_urgence_nom, contact_urgence_telephone)
            VALUES (?, ?, ?, ?)
        `, [employeeId, telephone_principal, contact_urgence_nom, contact_urgence_telephone]);

        // 6. Insertion dans la table `employee_affectations` (Historique initial)
        // L'affectation initiale sert de première ligne dans l'historique
        await connection.query(`
            INSERT INTO employee_affectations (
                employee_id, date_debut, motif, created_by_user_id,
                site_id_nouveau, department_id_nouveau, service_id_nouveau, team_id_nouveau, position_nouvelle, fonction_nouvelle
            )
            VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            employeeId, 'Embauche initiale', req.user.id, // req.user.id vient de authMiddleware (l'utilisateur connecté)
            site_id, department_id, service_id, team_id, position, fonction
        ]);

        // 7. Validation et Commit de la transaction
        await connection.commit();
        res.status(201).json({
            message: 'Employé créé avec succès et historique d\'affectation initialisé !',
            employeeId: employeeId
        });

    } catch (err) {
        // En cas d'erreur, annuler toutes les opérations
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la création de l\'employé.' });
    } finally {
        // Toujours libérer la connexion à la fin
        connection.release();
    }
    
});

// Route pour lire les informations complètes d'un employé par ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const employeeId = req.params.id;

        // Requête complexe joignant les trois tables de données de l'employé
        const sql = `
            SELECT 
                e.*, 
                ep.date_naissance, ep.genre, ep.nationalite, ep.situation_familiale,
                ec.adresse_complete, ec.telephone_principal, ec.contact_urgence_nom, ec.contact_urgence_telephone
            FROM employees e
            LEFT JOIN employee_personal ep ON e.id = ep.employee_id
            LEFT JOIN employee_contact ec ON e.id = ec.employee_id
            WHERE e.id = ?
        `;
        const [rows] = await db.query(sql, [employeeId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Employé non trouvé.' });
        }

        // Renvoie l'objet employé complet (le premier et unique résultat)
        res.status(200).json(rows[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la récupération de l\'employé.' });
    }
});

// Fichier: backend/routes/employee/employeeRoutes.js (Ajouts)

// Schéma de validation complet pour la modification de l'employé
// Notez que tous les champs sont optionnels car on ne modifie qu'une partie à la fois,
// mais on vérifie leur type et leur format s'ils sont présents.
const employeeUpdateSchema = Joi.object({
    // Données de base
    matricule: Joi.string().max(50).optional(),
    nom: Joi.string().optional(),
    prenom: Joi.string().optional(),
    
    // Affectation (champs déclencheurs de traçabilité)
    site_id: Joi.number().integer().min(1).optional(),
    department_id: Joi.number().integer().min(1).optional(),
    service_id: Joi.number().integer().min(1).optional(),
    team_id: Joi.number().integer().min(1).optional(),
    position: Joi.string().max(255).optional(),
    fonction: Joi.string().max(255).optional(),
    statut: Joi.string().valid('Actif', 'Congé', 'Maladie', 'Suspendu', 'Licencié').optional(),

    // Données personnelles
    date_naissance: Joi.date().iso().optional(),
    lieu_naissance: Joi.string().optional(),
    nationalite: Joi.string().optional(),
    genre: Joi.string().valid('M', 'F', 'Autre').optional(),
    nom_jeune_fille: Joi.string().optional().allow(null, ''),
    situation_familiale: Joi.string().optional().allow(null, ''),
    
    // Coordonnées
    adresse_complete: Joi.string().optional().allow(null, ''),
    telephone_principal: Joi.string().max(50).optional(),
    telephone_whatsapp: Joi.string().max(50).optional().allow(null, ''),
    email_personnel: Joi.string().email().max(255).optional().allow(null, ''),
    contact_urgence_nom: Joi.string().max(255).optional(),
    contact_urgence_telephone: Joi.string().max(50).optional(),
    
    // Champs pour l'historique/motif de changement (obligatoire si structure change)
    motif_changement: Joi.string().max(255).optional(),
    commentaire_changement: Joi.string().optional().allow(null, ''),
    
    // Lien utilisateur (gestion des RH)
    user_id: Joi.number().integer().optional().allow(null),
}).min(1); // Exige au moins un champ à modifier

// Route pour modifier un employé (PUT /api/employee/:id)
router.put('/:id', authMiddleware, async (req, res) => {
    const employeeId = req.params.id;
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const { error, value } = employeeUpdateSchema.validate(req.body);
        if (error) {
            await connection.rollback();
            return res.status(400).json({ message: error.details[0].message });
        }

        const fieldsToUpdate = value;
        
        // Si aucun champ n'est fourni, on sort (min(1) dans Joi devrait gérer ça)
        if (Object.keys(fieldsToUpdate).length === 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Aucun champ à modifier fourni.' });
        }

        // 1. Récupérer les données actuelles de l'employé
        const [currentEmpRows] = await connection.query(`
            SELECT site_id, department_id, service_id, team_id, position, fonction
            FROM employees WHERE id = ?
        `, [employeeId]);
        
        if (currentEmpRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Employé non trouvé.' });
        }
        const currentEmployee = currentEmpRows[0];

        // Détecter si un changement d'affectation a eu lieu
        const isAffectationChange = 
            (fieldsToUpdate.site_id && fieldsToUpdate.site_id !== currentEmployee.site_id) ||
            (fieldsToUpdate.department_id && fieldsToUpdate.department_id !== currentEmployee.department_id) ||
            (fieldsToUpdate.service_id && fieldsToUpdate.service_id !== currentEmployee.service_id) ||
            (fieldsToUpdate.team_id && fieldsToUpdate.team_id !== currentEmployee.team_id) ||
            (fieldsToUpdate.position && fieldsToUpdate.position !== currentEmployee.position) ||
            (fieldsToUpdate.fonction && fieldsToUpdate.fonction !== currentEmployee.fonction);

        // Si changement d'affectation, le motif est OBLIGATOIRE
        if (isAffectationChange && !fieldsToUpdate.motif_changement) {
            await connection.rollback();
            return res.status(400).json({ message: 'Motif de changement obligatoire pour les modifications d\'affectation/poste.' });
        }

        // --- Début Traitement Traçabilité ---
        if (isAffectationChange) {
            
            // 2. Terminer l'affectation précédente dans l'historique
            // On met la date de fin à HIER (CURDATE() - INTERVAL 1 DAY) pour éviter le chevauchement avec la nouvelle affectation
            await connection.query(`
                UPDATE employee_affectations
                SET date_fin = CURDATE() - INTERVAL 1 DAY, commentaire = CONCAT('Affectation terminée suite à: ', ?), created_by_user_id = ?
                WHERE employee_id = ? AND date_fin IS NULL
                ORDER BY date_debut DESC LIMIT 1 
            `, [fieldsToUpdate.motif_changement || 'Mutation/Changement de poste', req.user.id, employeeId]);


            // 3. Créer la nouvelle affectation dans l'historique
            await connection.query(`
                INSERT INTO employee_affectations (
                    employee_id, date_debut, motif, commentaire, created_by_user_id,
                    site_id_ancien, department_id_ancien, service_id_ancien, team_id_ancien, position_ancienne, fonction_ancienne,
                    site_id_nouveau, department_id_nouveau, service_id_nouveau, team_id_nouveau, position_nouvelle, fonction_nouvelle
                )
                VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                employeeId, 
                fieldsToUpdate.motif_changement, 
                fieldsToUpdate.commentaire_changement || null, 
                req.user.id,
                
                // Anciennes valeurs (pour l'historique)
                currentEmployee.site_id, 
                currentEmployee.department_id, 
                currentEmployee.service_id, 
                currentEmployee.team_id, 
                currentEmployee.position, 
                currentEmployee.fonction,

                // Nouvelles valeurs (celles modifiées, ou les anciennes sinon)
                fieldsToUpdate.site_id || currentEmployee.site_id,
                fieldsToUpdate.department_id || currentEmployee.department_id,
                fieldsToUpdate.service_id || currentEmployee.service_id,
                fieldsToUpdate.team_id || currentEmployee.team_id,
                fieldsToUpdate.position || currentEmployee.position,
                fieldsToUpdate.fonction || currentEmployee.fonction
            ]);
        }
        // --- Fin Traitement Traçabilité ---


        // 4. Mise à jour des tables principales (employees, personal, contact)
        
        // Liste des champs pour chaque table
        const employeeFields = ['matricule', 'nom', 'prenom', 'site_id', 'department_id', 'service_id', 'team_id', 'position', 'fonction', 'statut', 'user_id'];
        const personalFields = ['date_naissance', 'lieu_naissance', 'nationalite', 'genre', 'nom_jeune_fille', 'situation_familiale', 'photo_url'];
        const contactFields = ['adresse_complete', 'telephone_principal', 'telephone_whatsapp', 'email_personnel', 'contact_urgence_nom', 'contact_urgence_telephone'];

        // Fonction utilitaire pour générer la clause SET et les paramètres d'une requête UPDATE
        const buildUpdateQuery = (fields, tableName, idValue, idField = 'id') => {
            const updates = fields.filter(field => fieldsToUpdate[field] !== undefined);
            if (updates.length === 0) return null;

            const setClauses = updates.map(field => `${field} = ?`).join(', ');
            const params = updates.map(field => fieldsToUpdate[field]);
            
            params.push(idValue); // L'ID pour la clause WHERE

            return {
                sql: `UPDATE ${tableName} SET ${setClauses} WHERE ${idField} = ?`,
                params: params
            };
        };

        // Mise à jour de la table `employees`
        const empUpdate = buildUpdateQuery(employeeFields, 'employees', employeeId);
        if (empUpdate) await connection.query(empUpdate.sql, empUpdate.params);

        // Mise à jour de la table `employee_personal`
        const personalUpdate = buildUpdateQuery(personalFields, 'employee_personal', employeeId, 'employee_id');
        if (personalUpdate) await connection.query(personalUpdate.sql, personalUpdate.params);

        // Mise à jour de la table `employee_contact`
        const contactUpdate = buildUpdateQuery(contactFields, 'employee_contact', employeeId, 'employee_id');
        if (contactUpdate) await connection.query(contactUpdate.sql, contactUpdate.params);
        
        // 5. Validation et Commit de la transaction
        await connection.commit();
        res.status(200).json({
            message: 'Employé modifié avec succès. Historique mis à jour !',
            employeeId: employeeId,
            affectationChanged: isAffectationChange
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la modification de l\'employé.' });
    } finally {
        connection.release();
    }
});

// Fichier: backend/routes/employee/employeeRoutes.js (Ajouts)

// ... (Routes POST, GET, PUT existantes)

// Route pour "supprimer" (archiver/licencier) un employé
// DELETE /api/employee/:id
router.delete('/:id', authMiddleware, async (req, res) => {
    const employeeId = req.params.id;

    // Utilisation d'une transaction pour garantir l'intégrité
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Mise à jour du statut dans la table `employees` (Archivage / Soft Delete)
        // Ceci répond à l'exigence d'Archivage intelligent
        const [result] = await connection.query(
            'UPDATE employees SET statut = ? WHERE id = ?',
            ['Licencié', employeeId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Employé non trouvé.' });
        }
        
        // 2. Terminer son affectation actuelle dans l'historique
        // Enregistrement de la date de fin de l'affectation actuelle
        await connection.query(`
            UPDATE employee_affectations
            SET date_fin = CURDATE(), motif = CONCAT('Licenciement/Archivage par ', ?), created_by_user_id = ?
            WHERE employee_id = ? AND date_fin IS NULL
        `, ['Procédure de départ', req.user.id, employeeId]);
        
        // 3. Suppression du lien vers le compte utilisateur (si présent) pour libérer l'email.
        // Optionnel, mais bonne pratique de sécurité/gestion des accès.
        await connection.query(
            'UPDATE employees SET user_id = NULL WHERE id = ?',
            [employeeId]
        );

        // Validation et Commit de la transaction
        await connection.commit();

        res.status(200).json({
            message: 'Employé archivé (licencié) avec succès. Historique finalisé.',
            employeeId: employeeId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'archivage de l\'employé.' });
    } finally {
        connection.release();
    }
});


module.exports = router;






