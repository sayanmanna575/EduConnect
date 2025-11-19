const express = require('express');
const {
  hodLogin,
  getDepartmentFaculty,
  getFacultyById,
  updateFaculty,
  getDepartmentCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse
} = require('../controllers/hod.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Public route for HOD login
router.post('/login', hodLogin);

// Protected routes (HOD only)
router.use(protect);
router.use(authorize('hod'));

// HOD user management routes
router.get('/faculty', getDepartmentFaculty);
router.get('/faculty/:id', getFacultyById);
router.put('/faculty/:id', updateFaculty);

// HOD course management routes
router.get('/courses', getDepartmentCourses);
router.get('/courses/:id', getCourseById);
router.post('/courses', createCourse);
router.put('/courses/:id', updateCourse);
router.delete('/courses/:id', deleteCourse);

module.exports = router;