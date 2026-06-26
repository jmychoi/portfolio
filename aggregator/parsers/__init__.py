from .real_estate import RealEstateParser
from .rbc import RbcParser
from .tddi import TddiParser
from .wealthsimple import WealthsimpleParser


PARSERS = (WealthsimpleParser(), TddiParser(), RbcParser(), RealEstateParser())
