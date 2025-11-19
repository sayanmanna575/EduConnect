const User = require('../models/User');
const { hashPassword, comparePassword, generateAuthToken } = require('../utils/auth.utils');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response.utils');
const { logActivity } = require('../utils/activityLogger');

// Register user
const register = async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return errorResponse(res, 'User with this email already exists', 400);
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      department,
    });

    // Generate student/teacher ID based on role
    if (role === 'student') {
      user.studentId = `STU${Date.now()}`;
    } else if (role === 'teacher' || role === 'hod') {
      user.teacherId = `TEA${Date.now()}`;
      // For HOD, ensure department is provided
      if (role === 'hod' && !department) {
        return errorResponse(res, 'Department is required for HOD registration', 400);
      }
    }

    await user.save();

    // Generate auth token
    const token = generateAuthToken(user);

    // Return success response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      studentId: user.studentId,
      teacherId: user.teacherId,
    };

    successResponse(res, { user: userData, token }, 'User registered successfully', 201);
  } catch (error) {
    errorResponse(res, 'Registration failed', 500, error.message);
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Check if password is correct
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      // Log failed login attempt
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'login',
        actionLabel: 'Login attempt',
        description: `Failed login attempt - invalid password`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Check if user account is active
    if (!user.isActive) {
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'login',
        actionLabel: 'Login attempt',
        description: `Failed login attempt - account deactivated`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'Account is deactivated. Please contact administrator.', 401);
    }

    // Special handling for HOD role
    if (user.role === 'hod' && !user.department) {
      await logActivity({
        userId: user._id,
        userName: user.name,
        action: 'login',
        actionLabel: 'Login attempt',
        description: `Failed login attempt - HOD without department assignment`,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        status: 'failed'
      });
      return errorResponse(res, 'HOD account not properly configured. Please contact administrator.', 401);
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Generate auth token
    const token = generateAuthToken(user);
    
    // Log successful login
    await logActivity({
      userId: user._id,
      userName: user.name,
      action: 'login',
      actionLabel: 'Login',
      description: `Successful login as ${user.role}` + (user.department ? ` in ${user.department}` : ''),
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
      studentId: user.studentId,
      teacherId: user.teacherId,
    };

    successResponse(res, { user: userData, token }, 'Login successful');
  } catch (error) {
    errorResponse(res, 'Login failed', 500, error.message);
  }
};

// Get current user
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    successResponse(res, user, 'User fetched successfully');
  } catch (error) {
    errorResponse(res, 'Failed to fetch user', 500, error.message);
  }
};

module.exports = {
  register,
  login,
  getCurrentUser,
};