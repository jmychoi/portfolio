from .real_estate import RealEstateParser
from .tddi import TddiParser
from .wealthsimple import WealthsimpleParser


PARSERS = (WealthsimpleParser(), TddiParser(), RealEstateParser())

