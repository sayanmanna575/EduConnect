const Class = require('../models/Class');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/response.utils');
const { hashPassword, comparePassword } = require('../utils/auth.utils');
const { logActivity } = require('../utils/activityLogger');

// HOD login authentication
const hodLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find HOD user by email
    const user = await User.findOne({ email, role: 'hod' });
    if (!user) {
      return errorResponse(res, 'Invalid HOD credentials', 401);
    }

    // Check if password is correct
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      // Log failed login attempt
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'hod_login',
        actionLabel: 'HOD Login attempt',
        description: `Failed HOD login attempt - invalid password`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'Invalid HOD credentials', 401);
    }

    // Check if user account is active
    if (!user.isActive) {
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'hod_login',
        actionLabel: 'HOD Login attempt',
        description: `Failed HOD login attempt - account deactivated`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'HOD account is deactivated. Please contact administrator.', 401);
    }

    // Check if HOD has department assigned
    if (!user.department) {
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'hod_login',
        actionLabel: 'HOD Login attempt',
        description: `Failed HOD login attempt - HOD without department assignment`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'HOD account not properly configured. Please contact administrator.', 401);
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Log successful login
    await logActivity({
      userId: user._id,
      userName: user.name,
      action: 'hod_login',
      actionLabel: 'HOD Login',
      description: `Successful HOD login in ${user.department}`,
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      status: 'success'
    });

    // Return success response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      teacherId: user.teacherId,
    };

    successResponse(res, { user: userData }, 'HOD login successful');
  } catch (error) {
    errorResponse(res, 'HOD login failed', 500, error.message);
  }
};

// Get faculty members in HOD's department
const getDepartmentFaculty = async (req, res) => {
  try {
    // Get HOD's department from the authenticated user
    const hodDepartment = req.user.department;
    
    if (!hodDepartment) {
      return errorResponse(res, 'HOD not assigned to a department', 400);
    }

    // Find all faculty members in the same department
    const faculty = await User.find({
      role: { $in: ['teacher', 'hod'] },
      department: hodDepartment,
      isActive: true
    }).select('-password').sort({ name: 1 });

    successResponse(res, faculty, 'Department faculty fetched successfully');
  } catch (error) {
    errorResponse(res, 'Failed to fetch department faculty', 500, error.message);
  }
};

// Get faculty member by ID (only from HOD's department)
const getFacultyById = async (req, res) => {
  try {
    const { id } = req.params;
    const hodDepartment = req.user.department;

    // Find faculty member by ID and ensure they're in the same department
    const faculty = await User.findOne({
      _id: id,
      role: { $in: ['teacher', 'hod'] },
      department: hodDepartment,
      isActive: true
    }).select('-password');

    if (!faculty) {
      return errorResponse(res, 'Faculty member not found in your department', 404);
    }

    successResponse(res, faculty, 'Faculty member fetched successfully');
  } catch (error) {
    errorResponse(res, 'Failed to fetch faculty member', 500, error.message);
  }
};

// Update faculty member (limited permissions for HOD)
const updateFaculty = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, isActive } = req.body;
    const hodDepartment = req.user.department;

    // Find faculty member by ID and ensure they're in the same department
    const faculty = await User.findOne({
      _id: id,
      role: { $in: ['teacher', 'hod'] },
      department: hodDepartment
    });

    if (!faculty) {
      return errorResponse(res, 'Faculty member not found in your department', 404);
    }

    // HOD can only update limited fields
    if (name) faculty.name = name;
    if (email) faculty.email = email;
    if (isActive !== undefined) faculty.isActive = isActive;

    await faculty.save();

    const facultyData = faculty.toObject();
    delete facultyData.password;

    // Log the activity
    await logActivity({
      userId: req.user._id,
      userName: req.user.name,
      action: 'update_faculty',
      actionLabel: 'Update Faculty',
      description: `Updated faculty member ${faculty.name} in ${hodDepartment}`,
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      status: 'success'
    });

    successResponse(res, facultyData, 'Faculty member updated successfully');
  } catch (error) {
    errorResponse(res, 'Failed to update faculty member', 500, error.message);
  }
};

// Get courses from admin database for HOD's department
const getDepartmentCourses = async (req, res) => {
  try {
    // Get HOD's department from the authenticated user
    const hodDepartment = req.user.department;
    
    if (!hodDepartment) {
      return errorResponse(res, 'HOD not assigned to a department', 400);
    }

    // Find all classes where the teacher is in the same department as the HOD
    const classes = await Class.find()
      .populate({
        path: 'teacher',
        match: { department: hodDepartment },
        select: 'name email department'
      })
      .populate('students', 'name email studentId')
      .sort({ createdAt: -1 });

    // Filter classes to only include those with teachers from the HOD's department
    const departmentClasses = classes.filter(cls => cls.teacher !== null);

    successResponse(res, departmentClasses, 'Department courses fetched successfully');
  } catch (error) {
    errorResponse(res, 'Failed to fetch department courses', 500, error.message);
  }
};

// Get course by ID (only from HOD's department)
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const hodDepartment = req.user.department;

    // Find class by ID and ensure the teacher is in the same department
    const classItem = await Class.findById(id)
      .populate({
        path: 'teacher',
        match: { department: hodDepartment },
        select: 'name email department'
      })
      .populate('students', 'name email studentId');

    if (!classItem || !classItem.teacher) {
      return errorResponse(res, 'Course not found in your department', 404);
    }

    successResponse(res, classItem, 'Course fetched successfully');
  } catch (error) {
    errorResponse(res, 'Failed to fetch course', 500, error.message);
  }
};

// Create course (only for HOD's department)
const createCourse = async (req, res) => {
  try {
    const { name, code, description, schedule, teacherId } = req.body;
    const hodDepartment = req.user.department;
    
    if (!hodDepartment) {
      return errorResponse(res, 'HOD not assigned to a department', 400);
    }

    // Verify that the teacher belongs to the HOD's department
    const teacher = await User.findOne({
      _id: teacherId,
      role: 'teacher',
      department: hodDepartment,
      isActive: true
    });

    if (!teacher) {
      return errorResponse(res, 'Invalid teacher or teacher not in your department', 400);
    }

    // Create new class
    const newClass = new Class({
      name,
      code,
      description,
      schedule,
      teacher: teacherId,
    });

    await newClass.save();

    // Populate teacher details
    await newClass.populate('teacher', 'name email department');
    await newClass.populate('students', 'name email studentId');

    // Log the activity
    await logActivity({
      userId: req.user._id,
      userName: req.user.name,
      action: 'create_course',
      actionLabel: 'Create Course',
      description: `Created course ${newClass.name} in ${hodDepartment}`,
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      status: 'success'
    });

    successResponse(res, newClass, 'Course created successfully', 201);
  } catch (error) {
    errorResponse(res, 'Failed to create course', 500, error.message);
  }
};

// Update course (only for HOD's department)
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, schedule, isActive, teacherId } = req.body;
    const hodDepartment = req.user.department;
    
    if (!hodDepartment) {
      return errorResponse(res, 'HOD not assigned to a department', 400);
    }

    // Find class by ID and ensure the teacher is in the same department
    const classItem = await Class.findById(id);
    
    if (!classItem) {
      return errorResponse(res, 'Course not found', 404);
    }

    // Verify that the teacher belongs to the HOD's department (if teacher is being updated)
    if (teacherId) {
      const teacher = await User.findOne({
        _id: teacherId,
        role: 'teacher',
        department: hodDepartment,
        isActive: true
      });

      if (!teacher) {
        return errorResponse(res, 'Invalid teacher or teacher not in your department', 400);
      }
      
      classItem.teacher = teacherId;
    }

    // Update fields
    if (name) classItem.name = name;
    if (code) classItem.code = code;
    if (description) classItem.description = description;
    if (schedule) classItem.schedule = schedule;
    if (isActive !== undefined) classItem.isActive = isActive;

    await classItem.save();

    // Populate teacher details
    await classItem.populate('teacher', 'name email department');
    await classItem.populate('students', 'name email studentId');

    // Log the activity
    await logActivity({
      userId: req.user._id,
      userName: req.user.name,
      action: 'update_course',
      actionLabel: 'Update Course',
      description: `Updated course ${classItem.name} in ${hodDepartment}`,
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      status: 'success'
    });

    successResponse(res, classItem, 'Course updated successfully');
  } catch (error) {
    errorResponse(res, 'Failed to update course', 500, error.message);
  }
};

// Delete course (only for HOD's department)
const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const hodDepartment = req.user.department;
    
    if (!hodDepartment) {
      return errorResponse(res, 'HOD not assigned to a department', 400);
    }

    // Find class by ID and ensure the teacher is in the same department
    const classItem = await Class.findById(id)
      .populate({
        path: 'teacher',
        match: { department: hodDepartment },
        select: 'name email department'
      });

    if (!classItem || !classItem.teacher) {
      return errorResponse(res, 'Course not found in your department', 404);
    }

    await Class.findByIdAndDelete(id);

    // Log the activity
    await logActivity({
      userId: req.user._id,
      userName: req.user.name,
      action: 'delete_course',
      actionLabel: 'Delete Course',
      description: `Deleted course ${classItem.name} in ${hodDepartment}`,
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      status: 'success'
    });

    successResponse(res, null, 'Course deleted successfully');
  } catch (error) {
    errorResponse(res, 'Failed to delete course', 500, error.message);
  }
};

module.exports = {
  hodLogin,
  getDepartmentFaculty,
  getFacultyById,
  updateFaculty,
  getDepartmentCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse
};