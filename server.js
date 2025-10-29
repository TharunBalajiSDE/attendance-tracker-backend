require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());

app.use(express.json());
const port = 3000;
const DATABASE_URL = process.env.DATABASE_URL;

// ✅ Update your NeonDB connection string here
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * ✅ POST /login
 * Body: { email: "", password: "", device_id: "" }
 */
app.post("/login", async (req, res) => {
  const { email, password, device_id } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email, Password required" });
  }

  try {
    let query;
    let userType;

    if (email.endsWith("@engg")) {
      query = "SELECT * FROM students WHERE student_email = $1 AND student_password = $2";
      userType = "STUDENT";
    } else if (email.endsWith("@ac.in")) {
      query = "SELECT * FROM teachers WHERE teacher_email = $1 AND teacher_password = $2";
      userType = "TEACHER";
    } else {
      return res.status(400).json({ message: "Invalid email domain" });
    }

    const result = await pool.query(query, [email, password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const row = result.rows[0];

    // ✅ If student & device ID missing → update device ID
    if (userType === "STUDENT" && !row.student_device_id && device_id) {
      const updateQuery = `
        UPDATE students 
        SET student_device_id = $1 
        WHERE student_id = $2
        RETURNING student_device_id;
      `;
      await pool.query(updateQuery, [device_id, row.student_id]);
      row.student_device_id = device_id;
    }

    const user = {
      user_id: row.student_id || row.teacher_id,
      user_name: row.student_name || row.teacher_name,
      user_email: row.student_email || row.teacher_email,
      user_dept: row.student_dept || null,
      device_id: row.student_device_id || null
    };

    res.json({
      message: "Login successful ✅",
      user: user,
      user_type: userType
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Fetch students by department
app.get("/students/:dept", async (req, res) => {
  const { dept } = req.params;

  try {
    const client = await pool.connect();

    const query = `
      SELECT student_id, student_name, student_email, student_dept 
      FROM students
      WHERE student_dept = $1;
    `;

    const result = await client.query(query, [dept]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No students found for this department" });
    }

    res.json({
      count: result.rows.length,
      students: result.rows
    });

  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * ✅ GET /student/:id
 */
app.get("/student/:id", async (req, res) => {
  const studentId = req.params.id;

  try {
    const result = await pool.query("SELECT * FROM students WHERE student_id = $1", [
      studentId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching student:", error);
    res.status(500).json({ message: "DB Error" });
  }
});

/**
 * ✅ GET /attendance/:dept
 * Returns attendance only for today's date
 */
app.get("/attendance/:dept", async (req, res) => {
  const dept = req.params.dept;

  try {
    const result = await pool.query(
      `SELECT * FROM attendance 
       WHERE student_dept = $1 
       AND attendance_date::date = CURRENT_DATE`,
      [dept]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No attendance found for today" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ message: "DB Error" });
  }
});

/**
 * ✅ POST /attendance
 * Body -> { studentId, studentDept, status }
 */
app.post("/attendance", async (req, res) => {
  const { studentId, studentName, studentDept, status } = req.body;

  if (!studentId || !studentName || !studentDept || !status) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    await pool.query(
      `INSERT INTO attendance (student_id, student_dept, student_name, status)
       VALUES ($1, $2, $3, $4)`,
      [studentId, studentDept, studentName, status]
    );

    res.status(201).json({ message: "Attendance recorded successfully" });

  } catch (error) {
    console.error("Error inserting attendance:", error);
    res.status(500).json({ message: "DB Error" });
  }
});

// ✅ GET /attendance/:id (Today's status for a specific student)
app.get("/student-attendance/:id", async (req, res) => {
  const studentId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT status FROM attendance 
       WHERE student_id = $1 
       AND attendance_date::date = CURRENT_DATE`,
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.json([]); // Means ABSENT
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ message: "DB Error" });
  }
});

/**
 * ✅ POST /add-student
 * Body: { userId, userName, userEmail, userDept }
 */
app.post("/add-student", async (req, res) => {
  const { userId, userName, userEmail, userDept } = req.body;

  // ✅ Input Validation
  if (!userId || !userName || !userEmail || !userDept) {
    return res.status(400).json({ message: "All fields required" });
  }

  try {
    const query = `
      INSERT INTO students (student_id, student_name, student_email, student_dept, student_password)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const values = [userId, userName, userEmail, userDept, "1234"];
    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Student added successfully",
      student: result.rows[0]
    });

  } catch (error) {
    console.error("Error inserting student:", error);

    if (error.code === "23505") {
      return res.status(409).json({ message: "Student ID or Email already exists" });
    }

    res.status(500).json({ message: "Database Error" });
  }
});

/**
 * ✅ POST /reset-device
 * Resets device ID of the student by student_id
 */
app.post("/reset-device", async (req, res) => {
  const { userId } = req.body;

  // ✅ Input Validation
  if (!userId) {
    return res.status(400).json({ message: "Student ID required" });
  }

  try {
    const result = await pool.query(
      "UPDATE students SET student_device_id = NULL WHERE student_id = $1 RETURNING *",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json({
      message: "Device ID reset successfully",
      student: result.rows[0],
    });

  } catch (error) {
    console.error("Error resetting device ID:", error);
    res.status(500).json({ message: "DB Error" });
  }
});

/**
 * ✅ POST /update-device
 * Body: { student_id, device_id }
 */
app.post("/update-device", async (req, res) => {
  const { student_id, device_id } = req.body;

  if (!student_id || !device_id) {
    return res.status(400).json({
      message: "Missing student_id or device_id ❌"
    });
  }

  try {
    const updateQuery = `
      UPDATE students
      SET device_id = $1
      WHERE student_id = $2
      RETURNING student_id, student_name, device_id;
    `;

    const result = await pool.query(updateQuery, [device_id, student_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Student not found ❌"
      });
    }

    res.json({
      message: "Device ID updated successfully ✅",
      student: result.rows[0]
    });

  } catch (error) {
    console.error("Device Update Error:", error);
    res.status(500).json({ message: "Internal server error ❌" });
  }
});

/**
 * ✅ POST /mark-attendance
 * Body: { student_id, status }
 */
app.post("/mark-attendance", async (req, res) => {
  const { student_id, status } = req.body;

  if (!student_id || !status) {
    return res.status(400).json({ message: "Missing student_id or status" });
  }

  try {
    // 1️⃣ Try updating today's attendance
    const updateQuery = `
      UPDATE attendance
      SET status = $1
      WHERE student_id = $2
      AND DATE(attendance_date) = CURRENT_DATE
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, [status, student_id]);

    if (updateResult.rowCount > 0) {
      return res.json({
        message: "Attendance updated successfully ✅",
        data: updateResult.rows[0]
      });
    }

    // 2️⃣ Fetch student details if no attendance found
    const studentQuery = `
      SELECT student_name, student_email, student_dept
      FROM students
      WHERE student_id = $1;
    `;
    const studentResult = await pool.query(studentQuery, [student_id]);

    if (studentResult.rowCount === 0) {
      return res.status(404).json({
        message: "Student not found ❌"
      });
    }

    const { student_name, student_email, student_dept } = studentResult.rows[0];

    // 3️⃣ Insert new attendance entry
    const insertQuery = `
      INSERT INTO attendance (student_id, student_name, student_dept, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const insertResult = await pool.query(insertQuery, [
      student_id,
      student_name,
      student_dept,
      status
    ]);

    res.status(201).json({
      message: "New attendance entry created for today ✅",
      data: insertResult.rows[0]
    });

  } catch (error) {
    console.error("DB Error:", error);
    res.status(500).json({ message: "Database error ❌" });
  }
});

/**
 * ✅ GET /device/:studentId
 * Fetch Device ID for student
 */
app.get("/device/:studentId", async (req, res) => {
  const { studentId } = req.params;

  if (!studentId) {
    return res.status(400).json({ message: "Missing studentId" });
  }

  try {
    const query = `
      SELECT student_device_id 
      FROM students 
      WHERE student_id = $1;
    `;

    const result = await pool.query(query, [studentId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const deviceId = result.rows[0].student_device_id;

    return res.json({
      message: "Device ID fetched successfully ✅",
      student_id: studentId,
      device_id: deviceId || null
    });

  } catch (error) {
    console.error("DB Fetch Error:", error);
    res.status(500).json({ message: "Database error" });
  }
});

// Edit student details except student_id
app.post("/update/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { student_name, student_email, student_dept } = req.body;

    const client = await pool.connect();
    await client.query("BEGIN"); // Start transaction ✅

    // ✅ Update Students Table
    const updateStudentQuery = `
      UPDATE students
      SET 
        student_name = COALESCE($1, student_name),
        student_email = COALESCE($2, student_email),
        student_dept = COALESCE($3, student_dept)
      WHERE student_id = $4
      RETURNING *;
    `;

    const studentResult = await client.query(updateStudentQuery, [
      student_name,
      student_email,
      student_dept,
      studentId,
    ]);

    if (studentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ message: "Student not found" });
    }

    // ✅ Update Attendance table if needed
    if (student_dept || student_name) {
      const updateAttendanceQuery = `
        UPDATE attendance
        SET 
          student_dept = COALESCE($1, student_dept),
          student_name = COALESCE($2, student_name)
        WHERE student_id = $3;
      `;

      await client.query(updateAttendanceQuery, [
        student_dept,
        student_name,
        studentId
      ]);
    }

    await client.query("COMMIT");
    client.release();

    res.json({
      message: "Student updated successfully",
      student: studentResult.rows[0],
    });

  } catch (error) {
    console.error("Error updating student:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ✅ Server Status Endpoint (optional)
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "UP" });
  } catch (error) {
    res.status(500).json({ status: "DB_DOWN" });
  }
});

app.listen(port, () =>
  console.log(`✅ Server running at http://localhost:${port}`)
);