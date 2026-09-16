"""Local safety tests only; does not connect to any database."""
import unittest
from validate_mysql import preflight
class Safety(unittest.TestCase):
 def test_default_no_side_effects(self):self.assertIsNotNone(preflight({}))
 def test_requires_optin(self):self.assertIsNotNone(preflight({'MYSQL_TEST_DATABASE':'qisi_spec_safe'}))
 def test_rejects_production_db(self):self.assertIsNotNone(preflight({'QISI_MYSQL_SPEC_TEST':'1','MYSQL_TEST_DATABASE':'qisi'}))
 def test_rejects_sql_identifiers(self):
  for value in ['qisi_spec_;DROP TABLE owners','qisi_spec_../x','qisi_spec_','mysql']:
   self.assertIsNotNone(preflight({'QISI_MYSQL_SPEC_TEST':'1','MYSQL_TEST_DATABASE':value}))
 def test_accepts_explicit_isolated_name(self):self.assertIsNone(preflight({'QISI_MYSQL_SPEC_TEST':'1','MYSQL_TEST_DATABASE':'qisi_spec_smoke_01'}))
if __name__=='__main__':unittest.main()
