-- v9.74: 新增财务人员角色
ALTER TABLE users MODIFY role ENUM('admin', 'operator', 'finance') NOT NULL DEFAULT 'operator';
