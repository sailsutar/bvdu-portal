/**
 * Production: no built-in demo students.
 * Student academic data comes from Excel upload + MongoDB user accounts.
 */

/**
 * Resolve student for attendance gate / profile API.
 * Prefer MongoDB user; attendance may be supplied later via roster sync.
 */
export async function resolveStudentProfile(prn, UserModel) {
  const id = String(prn || "").trim();
  if (!id) {
    return {
      id: "",
      name: "Unknown",
      attendance: 0,
      email: null,
      phone: null,
      className: null,
      source: "empty",
    };
  }

  if (UserModel) {
    const user = await UserModel.findOne({ id, role: "student", isActive: true }).lean();
    if (user) {
      return {
        id: user.id,
        name: user.name,
        attendance:
          typeof user.attendance === "number"
            ? user.attendance
            : typeof user.attendancePct === "number"
              ? user.attendancePct
              : 100,
        email: user.email,
        phone: user.phone,
        className: user.className,
        source: "mongodb",
      };
    }
  }

  // Authenticated student not yet in academic roster: allow portal shell, strict feedback later
  return {
    id,
    name: `Student ${id}`,
    attendance: 0,
    email: `${id}@bvu.edu.in`,
    phone: null,
    className: null,
    source: "unregistered",
  };
}
